import { Component, Injectable, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { ErrorStateMatcher } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import {
  CostingApi,
  ExpenseItem,
  MaterialCost,
  PurchaseInvoiceLine,
  PurchaseItemType,
  SavePurchaseLine,
  Supplier,
  purchaseUnits,
} from '../../core/costing/costing.api';
import { Company } from '../../core/settings/company';
import { MoneyPipe } from '../../core/ui/money.pipe';
import { NotifyService } from '../../core/ui/notify.service';
import { ExpenseItemDialog, ExpenseItemDialogData } from './expense-item-dialog';
import { FormChecks, FormProblem } from './form-checks';
import { QuickMaterialData, QuickMaterialDialog, QuickMaterialResult } from './quick-material-dialog';
import { SupplierDialog, SupplierDialogData } from './supplier-dialog';
import { GridKeys } from '../shared/grid-keys';
import { PickRow } from '../shared/pick-row';
import { searchable, smartMatch } from '../shared/smart-search';
import { materialCostText } from './material-picker';

// A line's price this far from the material's average, either way, is flagged: check the unit.
export const priceGuardrailPercent = 25;

// An invoice's lines and supplier as they are entered, shared by the invoice screen and each
// invoice of a daily batch: what a line names and in what unit, what the lines come to, the
// supplier chosen, and the quick additions of a material, an expense or a supplier typed that is
// not there yet.

// The last options when what was typed matches nothing: add it, from the invoice, as a raw
// material or an expense item; or, in the supplier field, as a supplier.
export interface AddNew {
  addNew: string;
  as?: PurchaseItemType;
}

export interface InvoiceLine {
  // What the item field holds: text being typed, or the material or expense chosen.
  entry?: string | MaterialCost | ExpenseItem | AddNew | null;
  // Stock (a raw material) or an expense, as the item chosen is; null until one is.
  itemType: PurchaseItemType | null;
  rawMaterialId: string | null;
  expenseItemId: string | null;
  quantity: number | null;
  // How many of the material's own units the chosen unit holds: 1000 for kg of a material kept
  // in grams. Null until a material is chosen, then what it is bought by. An expense's is 1.
  unitSize: number | null;
  // An expense line's unit, as written (bottle, visit); none for a bill.
  unitLabel: string;
  // What the line came to as written (إجمالي السطر), and what was taken off it (الخصم).
  cost: number | null;
  discount: number | null;
}

export function blankLine(): InvoiceLine {
  return { itemType: null, rawMaterialId: null, expenseItemId: null, quantity: null, unitSize: null, unitLabel: '', cost: null, discount: 0 };
}

// To the piastre, as amounts are kept.
function piastres(amount: number): number {
  return Math.round(amount * 100) / 100;
}

const baseLabels = { Gram: 'g', Millilitre: 'ml', Piece: 'pc' } as const;

// As the till compares names: capitals and extra spaces aside.
function normalize(name: string): string {
  return name.trim().split(/\s+/).join(' ').toUpperCase();
}

function isMaterial(item: MaterialCost | ExpenseItem): item is MaterialCost {
  return 'purchaseUnitSize' in item;
}

// What a screen's invoices can name, loaded once for it: the materials bought (prep items are made
// in the kitchen), the expense items and the suppliers new invoices can use; and adding one from an
// invoice, by its quick dialog. Provided by each screen that enters invoices.
@Injectable()
export class PurchaseCatalog {
  private readonly api = inject(CostingApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly company = inject(Company);

  // An amount in the company's currency.
  money(amount: number): string {
    return this.company.money(amount);
  }

  readonly materials = signal<MaterialCost[]>([]);
  // The archived ones are not offered.
  readonly expenses = signal<ExpenseItem[]>([]);
  readonly suppliers = signal<Supplier[]>([]);

  async load(): Promise<void> {
    const [materials, suppliers, expenses] = await Promise.all([
      firstValueFrom(this.api.materials()),
      firstValueFrom(this.api.suppliers()),
      firstValueFrom(this.api.expenseItems()),
    ]);
    this.materials.set(materials.filter((m) => m.kind !== 'Prep'));
    this.suppliers.set(suppliers);
    this.expenses.set(expenses);
  }

  async loadMaterials(): Promise<void> {
    this.materials.set((await firstValueFrom(this.api.materials())).filter((m) => m.kind !== 'Prep'));
  }

  // The quick dialog over the invoice. The new material, as listed now; or its name and id when the
  // list does not have it yet; null when cancelled.
  async addMaterial(name: string): Promise<MaterialCost | { id: string; name: string } | null> {
    const created = await firstValueFrom(
      this.dialog
        .open<QuickMaterialDialog, QuickMaterialData, QuickMaterialResult>(QuickMaterialDialog, { data: { name }, width: '520px' })
        .afterClosed(),
    );
    if (!created) {
      return null;
    }
    await this.loadMaterials();
    this.notify.info(`${created.name} added, and on the invoice.`);
    return this.materials().find((m) => m.id === created.id) ?? { id: created.id, name: created.name };
  }

  async addExpense(name: string): Promise<ExpenseItem | null> {
    const created = await firstValueFrom(
      this.dialog
        .open<ExpenseItemDialog, ExpenseItemDialogData, ExpenseItem>(ExpenseItemDialog, { data: { name, fromInvoice: true }, width: '480px' })
        .afterClosed(),
    );
    if (!created) {
      return null;
    }
    this.expenses.set(await firstValueFrom(this.api.expenseItems()));
    this.notify.info(`${created.name} added, and on the invoice.`);
    return this.expenses().find((e) => e.id === created.id) ?? created;
  }

  async addSupplier(name: string): Promise<Supplier | null> {
    const created = await firstValueFrom(
      this.dialog
        .open<SupplierDialog, SupplierDialogData, Supplier>(SupplierDialog, { data: { name, fromInvoice: true }, width: '520px' })
        .afterClosed(),
    );
    if (!created) {
      return null;
    }
    this.suppliers.set(await firstValueFrom(this.api.suppliers()));
    this.notify.info(`${created.name} added, and on the invoice.`);
    return this.suppliers().find((s) => s.id === created.id) ?? created;
  }

  supplierNamed(name: string): Supplier | undefined {
    const key = normalize(name);
    return this.suppliers().find((s) => normalize(s.name) === key);
  }
}

// One invoice's lines as they are entered, and its own discount.
export class InvoiceLines {
  readonly lines = signal<InvoiceLine[]>([blankLine()]);

  // The discount on the whole invoice (خصم الفاتورة), off what the lines come to after theirs.
  readonly discount = signal<number | null>(0);

  // The lines are changed in place by the form; this bumps the signal so totals follow.
  readonly version = signal(0);

  // What the lines came to as written, and their own discounts.
  readonly subtotal = computed(() => {
    this.version();
    return piastres(this.lines().reduce((sum, l) => sum + (l.cost ?? 0), 0));
  });

  readonly lineDiscounts = computed(() => {
    this.version();
    return piastres(this.lines().reduce((sum, l) => sum + (l.discount ?? 0), 0));
  });

  // The invoice's discount shared among the priced lines by what each comes to after its own, as
  // the server shares it: to the piastre, each share rounded down and the piastres left one each to
  // the lines that lost the most to rounding. None while the discount is more than the lines.
  readonly shares = computed(() => {
    this.version();
    const shares = new Map<InvoiceLine, number>();
    const cents = Math.round((this.discount() ?? 0) * 100);
    const priced = this.lines().filter((l) => (this.ownNet(l) ?? 0) > 0);
    const net = priced.reduce((sum, l) => sum + this.ownNet(l)!, 0);
    if (cents <= 0 || cents > Math.round(net * 100)) {
      return shares;
    }
    const exact = priced.map((l) => (cents * this.ownNet(l)!) / net);
    const floors = exact.map((e) => Math.floor(e + 1e-9));
    const left = cents - floors.reduce((sum, f) => sum + f, 0);
    priced
      .map((_, i) => i)
      .sort((a, b) => exact[b] - floors[b] - (exact[a] - floors[a]) || a - b)
      .slice(0, left)
      .forEach((i) => floors[i]++);
    priced.forEach((l, i) => shares.set(l, floors[i] / 100));
    return shares;
  });

  // Both discounts together, and what is paid after them (الصافي المستحق).
  readonly totalDiscount = computed(() => {
    this.version();
    return piastres(this.lineDiscounts() + [...this.shares().values()].reduce((sum, s) => sum + s, 0));
  });

  readonly total = computed(() => {
    this.version();
    return piastres(this.lines().reduce((sum, l) => sum + (this.netCost(l) ?? 0), 0));
  });

  // The total split: what goes into stock, and what is expenses.
  readonly totals = computed(() => {
    this.version();
    const sum = (type: PurchaseItemType) =>
      piastres(this.lines().filter((l) => l.itemType === type).reduce((s, l) => s + (this.netCost(l) ?? 0), 0));
    return { stock: sum('Inventory'), expenses: sum('Expense') };
  });

  // Every line names an item and a quantity; nothing twice; costs, where given, not negative, and
  // always given for an expense, which is nothing else.
  readonly ready = computed(() => this.problems().length === 0);

  // What holds the lines up, each by its line and field. prefix tells one invoice's from
  // another's, as the table's label does: "Invoice 2, ".
  problems(prefix = ''): FormProblem[] {
    this.version();
    const lines = this.lines();
    return lines.flatMap((line, i) => {
      const where = prefix ? `${prefix}line ${i + 1}` : `Line ${i + 1}`;
      const field = (name: string) => `${prefix}${name}, line ${i + 1}`;
      const found: FormProblem[] = [];
      const id = line.rawMaterialId ?? line.expenseItemId;
      if (!id) {
        const typed = typeof line.entry === 'string' && line.entry.trim();
        found.push({ where, what: typed ? 'choose the item from the list, or add it' : 'choose the item', field: field('Item') });
      } else if (lines.findIndex((l) => (l.rawMaterialId ?? l.expenseItemId) === id) < i) {
        found.push({ where, what: 'it is on the invoice twice: put it on one line', field: field('Item') });
      }
      if (!((line.quantity ?? 0) > 0)) {
        found.push({ where, what: 'enter the quantity', field: field('Quantity') });
      }
      if (line.cost === null ? line.itemType === 'Expense' : line.cost < 0) {
        found.push({ where, what: line.cost === null ? 'enter what the expense cost' : 'the line total cannot be below 0', field: field('Line total') });
      }
      const discount = line.discount ?? 0;
      if (discount < 0) {
        found.push({ where, what: 'the discount cannot be below 0', field: field('Discount') });
      } else if (discount > 0 && line.cost === null) {
        found.push({ where, what: 'enter the line total before its discount', field: field('Discount') });
      } else if (line.cost !== null && discount > line.cost) {
        found.push({ where, what: 'the discount cannot be more than the line total', field: field('Discount') });
      }
      return found;
    }).concat(this.discountProblems(prefix));
  }

  private discountProblems(prefix: string): FormProblem[] {
    const discount = this.discount() ?? 0;
    const where = prefix ? `${prefix}invoice discount` : 'Invoice discount';
    const field = `${prefix}Invoice discount`;
    const net = this.lines().reduce((sum, l) => sum + Math.max(this.ownNet(l) ?? 0, 0), 0);
    if (discount < 0) {
      return [{ where, what: 'it cannot be below 0', field }];
    }
    if (discount > 0 && net <= 0) {
      return [{ where, what: 'enter the line totals before the invoice discount', field }];
    }
    if (Math.round(discount * 100) > Math.round(net * 100)) {
      return [{ where, what: 'it cannot be more than the lines come to', field }];
    }
    return [];
  }

  // What a line comes to after its own discount; and after its share of the invoice's too: what it
  // really cost, what is paid, and what goes into the average. Null with no line total.
  ownNet(line: InvoiceLine): number | null {
    return line.cost === null ? null : piastres(line.cost - (line.discount ?? 0));
  }

  netCost(line: InvoiceLine): number | null {
    const own = this.ownNet(line);
    return own === null ? null : piastres(own - (this.shares().get(line) ?? 0));
  }

  // A line's share of the invoice's discount, while it has one.
  share(line: InvoiceLine): number {
    return this.shares().get(line) ?? 0;
  }

  constructor(readonly catalog: PurchaseCatalog) {}

  touch(): void {
    this.version.update((v) => v + 1);
  }

  add(): void {
    this.lines.update((lines) => [...lines, blankLine()]);
  }

  remove(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  reset(): void {
    this.lines.set([blankLine()]);
    this.discount.set(0);
    this.touch();
  }

  material(line: InvoiceLine): MaterialCost | undefined {
    return line.rawMaterialId ? this.catalog.materials().find((m) => m.id === line.rawMaterialId) : undefined;
  }

  expense(line: InvoiceLine): ExpenseItem | undefined {
    return line.expenseItemId ? this.catalog.expenses().find((e) => e.id === line.expenseItemId) : undefined;
  }

  units(material: MaterialCost): { label: string; size: number }[] {
    return purchaseUnits(material);
  }

  label(material: MaterialCost): string {
    return material.code ? `${material.code} · ${material.name}` : material.name;
  }

  // What the field shows for a choice: the material, the expense, or the name being added.
  readonly display = (value: string | MaterialCost | ExpenseItem | AddNew | null | undefined): string =>
    !value ? '' : typeof value === 'string' ? value : 'addNew' in value ? value.addNew : isMaterial(value) ? this.label(value) : value.name;

  // The materials and expenses matching what is typed, the closest first (its code, then a name
  // that starts with it); all of them before anything is.
  matches(line: InvoiceLine): { materials: MaterialCost[]; expenses: ExpenseItem[] } {
    const text = typeof line.entry === 'string' ? line.entry : '';
    const typed = searchable(text);
    const rank = (name: string, code: string | null) =>
      !typed ? 2 : searchable(code) === typed ? 0 : searchable(name).startsWith(typed) ? 1 : 2;
    return {
      materials: this.catalog
        .materials()
        .filter((m) => smartMatch(text, m.name, m.code, m.category))
        .sort((a, b) => rank(a.name, a.code) - rank(b.name, b.code) || a.name.localeCompare(b.name)),
      expenses: this.catalog
        .expenses()
        .filter((e) => smartMatch(text, e.name, e.nameAr, e.category))
        .sort((a, b) => rank(a.name, null) - rank(b.name, null) || a.name.localeCompare(b.name)),
    };
  }

  // What a material costs now, per the unit it is bought in.
  costText(material: MaterialCost): string | null {
    return materialCostText(material, (n) => this.catalog.money(n));
  }

  // The typed name, when nothing is called exactly that: it can be added, as either.
  typedNew(line: InvoiceLine): string | null {
    const text = typeof line.entry === 'string' ? line.entry.trim() : '';
    const key = text.toLowerCase();
    return text &&
      !this.catalog.materials().some((m) => m.name.toLowerCase() === key) &&
      !this.catalog.expenses().some((e) => e.name.toLowerCase() === key)
      ? text
      : null;
  }

  // Typing, choosing a material or an expense, or choosing to add one. A material chosen is taken
  // in what it is bought by until another unit is picked; an expense in its usual unit, one of it.
  entered(line: InvoiceLine, value: string | MaterialCost | ExpenseItem | AddNew | null): void {
    if (value && typeof value === 'object' && 'addNew' in value) {
      void (value.as === 'Expense' ? this.addExpense(line, value.addNew) : this.addMaterial(line, value.addNew));
      return;
    }
    this.choose(line, value && typeof value === 'object' ? value : null);
    this.touch();
  }

  // Added, and on this line; cancelled, the line keeps what was typed.
  async addExpense(line: InvoiceLine, name: string): Promise<void> {
    const item = await this.catalog.addExpense(name);
    line.entry = item ?? name;
    if (item) {
      this.choose(line, item);
    }
    this.touch();
  }

  // Added, and on this line: nothing else on the invoice changes. Cancelled, the line keeps what was typed.
  async addMaterial(line: InvoiceLine, name: string): Promise<void> {
    const created = await this.catalog.addMaterial(name);
    if (!created) {
      line.entry = name;
      this.touch();
      return;
    }
    if ('purchaseUnitSize' in created) {
      line.entry = created;
      this.choose(line, created);
    } else {
      line.entry = created.name;
      Object.assign(line, { itemType: 'Inventory', rawMaterialId: created.id, expenseItemId: null, unitSize: null });
    }
    this.touch();
  }

  private choose(line: InvoiceLine, item: MaterialCost | ExpenseItem | null): void {
    const material = item && isMaterial(item) ? item : null;
    const expense = item && !isMaterial(item) ? item : null;
    line.itemType = material ? 'Inventory' : expense ? 'Expense' : null;
    line.rawMaterialId = material?.id ?? null;
    line.expenseItemId = expense?.id ?? null;
    line.unitSize = material?.purchaseUnitSize ?? (expense ? 1 : null);
    if (expense) {
      line.unitLabel = expense.unit ?? '';
      line.quantity ??= 1;
    }
  }

  // The line's quantity in the material's own unit, as stock is kept.
  baseQuantity(line: InvoiceLine): number | null {
    const material = this.material(line);
    if (!material || !line.quantity || line.quantity <= 0) {
      return null;
    }
    // To the thousandth, as stock is stored: 0.1 kg is 100 g, not 100.00000000000001.
    return Math.round(line.quantity * (line.unitSize ?? material.purchaseUnitSize) * 1000) / 1000;
  }

  stockAdded(line: InvoiceLine): string | null {
    const material = this.material(line);
    const base = this.baseQuantity(line);
    if (!material || base === null || (line.unitSize ?? material.purchaseUnitSize) === 1) {
      return null;
    }
    return `${base.toLocaleString('en-EG', { maximumFractionDigits: 3 })} ${baseLabels[material.unit]}`;
  }

  // What the line paid per purchase unit after every discount, whatever unit it was entered in:
  // comparable with the average beside it, which it moves. An expense's: per one of what it is
  // counted in.
  unitPrice(line: InvoiceLine): number | null {
    const cost = this.netCost(line);
    if (this.expense(line)) {
      return cost !== null && line.quantity ? cost / line.quantity : null;
    }
    const material = this.material(line);
    const base = this.baseQuantity(line);
    return material && base && cost !== null ? (cost / base) * material.purchaseUnitSize : null;
  }

  // How far the line's price per purchase unit is from the material's moving average now, as a
  // share of it, when that is more than the guardrail allows (±25%): most often a quantity typed in
  // the wrong unit (grams as kilos, a carton as a piece). Null when it is within, or there is
  // nothing to compare. It warns; it never stops the invoice.
  priceDeviation(line: InvoiceLine): number | null {
    const material = this.material(line);
    const average = material?.costPerPurchaseUnit;
    const price = this.unitPrice(line);
    if (!material || this.expense(line) || average == null || average <= 0 || price === null) {
      return null;
    }
    const percent = ((price - average) / average) * 100;
    if (Math.abs(percent) <= priceGuardrailPercent) {
      return null;
    }
    // Whole points, but a price not quite nothing is never said to be −100%.
    const whole = Math.round(percent);
    return whole === -100 && percent !== -100 ? Math.round(percent * 10) / 10 : whole;
  }

  // The lines as an invoice sends them. Lines not finished yet are left out of a draft saved only
  // to hold its paper (partial), and a discount not right yet kept back from it.
  toSave(partial = false): SavePurchaseLine[] {
    const discountOf = (l: InvoiceLine) => {
      const discount = l.discount ?? 0;
      return partial && (discount < 0 || discount > (l.cost ?? 0)) ? 0 : discount;
    };
    return this.lines()
      .filter((l) => !partial || ((l.rawMaterialId || (l.expenseItemId && l.cost !== null)) && (l.quantity ?? 0) > 0))
      .map((l): SavePurchaseLine => {
        if (l.itemType === 'Expense') {
          return {
            itemType: 'Expense',
            rawMaterialId: null,
            expenseItemId: l.expenseItemId,
            enteredQuantity: l.quantity!,
            unitLabel: l.unitLabel.trim() || null,
            unitSize: 1,
            cost: l.cost,
            discount: discountOf(l),
          };
        }
        const material = this.material(l)!;
        const size = l.unitSize ?? material.purchaseUnitSize;
        return {
          itemType: 'Inventory',
          rawMaterialId: l.rawMaterialId!,
          expenseItemId: null,
          enteredQuantity: l.quantity!,
          unitLabel: purchaseUnits(material).find((u) => u.size === size)?.label ?? material.purchaseUnit,
          unitSize: size,
          cost: l.cost,
          discount: discountOf(l),
        };
      });
  }

  // The invoice's discount as sent: on a draft saved only to hold its paper, none while it is more
  // than the lines finished so far come to.
  discountToSave(partial = false): number {
    const discount = this.discount() ?? 0;
    if (!partial) {
      return discount;
    }
    const net = this.toSave(true).reduce((sum, l) => sum + Math.max((l.cost ?? 0) - l.discount, 0), 0);
    return discount > 0 && Math.round(discount * 100) <= Math.round(net * 100) ? discount : 0;
  }

  // A saved invoice's lines and discount, back on screen as they were entered: each line at its
  // total as written, before its discounts.
  fill(lines: PurchaseInvoiceLine[], discount = 0): void {
    this.discount.set(discount);
    this.lines.set(
      lines.length
        ? lines.map((l) => ({
            entry:
              (l.itemType === 'Expense'
                ? this.catalog.expenses().find((e) => e.id === l.expenseItemId)
                : this.catalog.materials().find((m) => m.id === l.rawMaterialId)) ?? l.material,
            itemType: l.itemType,
            rawMaterialId: l.rawMaterialId,
            expenseItemId: l.expenseItemId,
            quantity: l.enteredQuantity,
            unitSize: l.unitSize,
            unitLabel: l.itemType === 'Expense' && l.unitLabel !== 'unit' ? l.unitLabel : '',
            cost: l.lineTotal ?? l.cost,
            discount: l.discount ?? 0,
          }))
        : [blankLine()],
    );
    this.touch();
  }
}

// One invoice's supplier as it is entered: chosen from the list, or typed and added.
export class InvoiceSupplier {
  // What the field holds: text being typed, a supplier chosen, or one to add.
  entry: string | Supplier | AddNew | null = '';
  id: string | null = null;
  readonly version = signal(0);

  constructor(readonly catalog: PurchaseCatalog) {}

  touch(): void {
    this.version.update((v) => v + 1);
  }

  // The suppliers matching what is typed (by name, contact or phone), names starting with it first;
  // all of them before anything is.
  matches(): Supplier[] {
    const text = typeof this.entry === 'string' ? this.entry : '';
    const typed = searchable(text);
    return this.catalog
      .suppliers()
      .filter((s) => smartMatch(text, s.name, s.contactPerson, s.phone))
      .sort((a, b) => Number(!searchable(a.name).startsWith(typed)) - Number(!searchable(b.name).startsWith(typed)) || a.name.localeCompare(b.name));
  }

  // The typed name, when no supplier is called that (capitals and extra spaces aside): it can be added.
  typedNew(): string | null {
    const text = typeof this.entry === 'string' ? this.entry.trim() : '';
    return text && !this.catalog.supplierNamed(text) ? text : null;
  }

  readonly label = (value: string | Supplier | AddNew | null | undefined): string =>
    !value ? '' : typeof value === 'string' ? value : 'addNew' in value ? value.addNew : value.name;

  // A name typed that is no supplier yet: neither chosen nor added.
  unresolved(): boolean {
    this.version();
    return typeof this.entry === 'string' && this.entry.trim() !== '' && this.id === null;
  }

  // Typing, choosing a supplier, or choosing to add one. A name typed in full is that supplier.
  entered(value: string | Supplier | AddNew | null): void {
    if (value && typeof value === 'object' && 'addNew' in value) {
      void this.add(value.addNew);
      return;
    }
    this.id = !value ? null : typeof value === 'string' ? (this.catalog.supplierNamed(value)?.id ?? null) : value.id;
    this.touch();
  }

  // The quick dialog over the invoice: the supplier is added and chosen. Cancelled, the field keeps
  // what was typed.
  async add(name: string): Promise<void> {
    const created = await this.catalog.addSupplier(name);
    this.entry = created ?? name;
    this.id = created?.id ?? null;
    this.touch();
  }

  // Back to none, or to one already chosen (archived since or not: a draft keeps the one it had).
  set(id: string | null, name: string | null = null): void {
    this.id = id;
    this.entry = !id ? '' : (this.catalog.suppliers().find((s) => s.id === id) ?? ({ id, name: name ?? 'A supplier' } as Supplier));
    this.touch();
  }
}

// Material's own: a field in error once touched and invalid.
const defaultMatcher = new ErrorStateMatcher();

// An invoice's lines as a table: each line's item, found by typing or added there, its quantity
// in the unit billed, its total and discount, what it comes to per purchase unit after every
// discount beside the average now; a line added or taken off; and the subtotal, the invoice's
// discount, and what is paid after them, split into stock and expenses when it has both.
@Component({
  selector: 'app-invoice-lines',
  imports: [FormsModule, GridKeys, MatAutocompleteModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MoneyPipe, PickRow],
  template: `
    @let e = editor();
    <div class="table-wrap">
      <table class="grid" appGridKeys (appGridKeysAppend)="e.add()">
        <thead>
          <tr>
            <th>Item<span class="ar">الصنف</span></th>
            <th class="num">Quantity<span class="ar">الكمية</span></th>
            <th class="num">Line total<span class="ar">إجمالي السطر</span></th>
            <th class="num">Discount<span class="ar">الخصم</span></th>
            <th class="num">AP$ per purchase unit<span class="ar">سعر وحدة الشراء</span></th>
            <th class="num">Average now<span class="ar">المتوسط الحالي</span></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (line of e.lines(); track $index; let i = $index) {
            <tr>
              <td>
                <mat-form-field subscriptSizing="dynamic" class="material">
                  <input matInput [matAutocomplete]="auto" [(ngModel)]="line.entry" (ngModelChange)="e.entered(line, $event)"
                    placeholder="Type to find…" [attr.aria-label]="label() + 'Item, line ' + (i + 1)"
                    [errorStateMatcher]="marked(label() + 'Item, line ' + (i + 1))" />
                  <mat-autocomplete #auto="matAutocomplete" [displayWith]="e.display" panelClass="pick-panel" [panelWidth]="460" [autoActiveFirstOption]="true">
                    @if (e.matches(line); as found) {
                      @if (found.materials.length) {
                        <mat-optgroup label="Stock items · خامات">
                          @for (m of found.materials; track m.id) {
                            <mat-option [value]="m">
                              <app-pick-row [name]="m.name" [code]="m.code" [kind]="m.kind === 'Prep' ? 'prep' : 'material'" [unit]="m.purchaseUnit"
                                [detail]="m.category" [cost]="e.costText(m)" />
                            </mat-option>
                          }
                        </mat-optgroup>
                      }
                      @if (found.expenses.length) {
                        <mat-optgroup label="Expenses · مصروفات">
                          @for (x of found.expenses; track x.id) {
                            <mat-option [value]="x">
                              <app-pick-row [name]="x.name" kind="expense" [unit]="x.unit" [detail]="x.nameAr ? x.category + ' · ' + x.nameAr : x.category" />
                            </mat-option>
                          }
                        </mat-optgroup>
                      }
                    }
                    @if (e.typedNew(line); as name) {
                      <mat-option [value]="{ addNew: name, as: 'Inventory' }" class="add-new">
                        <mat-icon>add</mat-icon> Add new material: "{{ name }}"
                      </mat-option>
                      <mat-option [value]="{ addNew: name, as: 'Expense' }" class="add-new">
                        <mat-icon>add</mat-icon> Add new expense: "{{ name }}"
                      </mat-option>
                    }
                  </mat-autocomplete>
                  <mat-error>{{ said(label() + 'Item, line ' + (i + 1)) }}</mat-error>
                </mat-form-field>
                @if (e.expense(line)) {
                  <span class="badge expense">Expense · مصروف</span>
                }
              </td>
              <td class="num">
                <div class="quantity">
                  <mat-form-field subscriptSizing="dynamic" class="small">
                    <input matInput type="number" min="0" step="any" [(ngModel)]="line.quantity" (ngModelChange)="e.touch()"
                      [attr.aria-label]="label() + 'Quantity, line ' + (i + 1)" [errorStateMatcher]="marked(label() + 'Quantity, line ' + (i + 1))" />
                    <mat-error>{{ said(label() + 'Quantity, line ' + (i + 1)) }}</mat-error>
                  </mat-form-field>
                  @if (e.material(line); as m) {
                    <mat-form-field subscriptSizing="dynamic" class="unit">
                      <mat-select [(ngModel)]="line.unitSize" (ngModelChange)="e.touch()" [aria-label]="label() + 'Unit, line ' + (i + 1)">
                        @for (u of e.units(m); track u.size) {
                          <mat-option [value]="u.size">{{ u.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                  } @else if (e.expense(line)) {
                    <mat-form-field subscriptSizing="dynamic" class="unit">
                      <input matInput [(ngModel)]="line.unitLabel" maxlength="32" placeholder="unit" [attr.aria-label]="label() + 'Unit, line ' + (i + 1)" />
                    </mat-form-field>
                  }
                </div>
                @if (e.stockAdded(line); as added) {
                  <small class="muted">+ {{ added }} to stock</small>
                } @else if (e.expense(line)) {
                  <small class="muted">Not stock</small>
                }
              </td>
              <td class="num">
                <mat-form-field subscriptSizing="dynamic" class="small">
                  <span matTextPrefix>{{ company.currency() }}&nbsp;</span>
                  <input matInput type="number" min="0" step="any" [(ngModel)]="line.cost" (ngModelChange)="e.touch()"
                    [attr.aria-label]="label() + 'Line total, line ' + (i + 1)" [required]="!!e.expense(line)"
                    [errorStateMatcher]="marked(label() + 'Line total, line ' + (i + 1))" />
                  <mat-error>{{ said(label() + 'Line total, line ' + (i + 1)) }}</mat-error>
                </mat-form-field>
                @if (e.expense(line) && line.cost === null && !checks()?.shown()) {
                  <small class="warn-text">Its amount</small>
                }
              </td>
              <td class="num">
                <mat-form-field subscriptSizing="dynamic" class="discount">
                  <span matTextPrefix>{{ company.currency() }}&nbsp;</span>
                  <input matInput type="number" min="0" step="any" [(ngModel)]="line.discount" (ngModelChange)="e.touch()"
                    [attr.aria-label]="label() + 'Discount, line ' + (i + 1)" [errorStateMatcher]="marked(label() + 'Discount, line ' + (i + 1))" />
                  <mat-error>{{ said(label() + 'Discount, line ' + (i + 1)) }}</mat-error>
                </mat-form-field>
                @if (e.share(line) > 0) {
                  <small class="muted share" title="Its share of the invoice discount · نصيبه من خصم الفاتورة">+ {{ e.share(line) | money }} shared</small>
                }
                @if (e.share(line) > 0 || (line.discount ?? 0) > 0) {
                  <small class="net">Net · الصافي {{ e.netCost(line) | money }}</small>
                }
              </td>
              <td class="num">
                {{ e.unitPrice(line) === null ? '' : (e.unitPrice(line) | money) }}
                @if (e.priceDeviation(line); as off) {
                  <div class="price-alert" role="status">
                    <mat-icon aria-hidden="true">warning</mat-icon>
                    <span>
                      <span lang="ar" dir="rtl">تنبيه: السعر يختلف بـ {{ off > 0 ? '+' : '' }}{{ off }}% عن المتوسط الحالي - تأكد من الوحدة!</span>
                      <span class="en">{{ off > 0 ? '+' : '' }}{{ off }}% from the average now: check the unit.</span>
                    </span>
                  </div>
                }
              </td>
              <td class="num muted">
                @if (e.expense(line); as x) {
                  <span class="category">{{ x.category }}</span>
                } @else {
                  {{ e.material(line)?.costPerPurchaseUnit == null ? '' : (e.material(line)!.costPerPurchaseUnit | money) }}
                }
              </td>
              <td>
                <button mat-icon-button (click)="e.remove(i)" [disabled]="e.lines().length === 1" [attr.aria-label]="label() + 'Remove line'">
                  <mat-icon>delete</mat-icon>
                </button>
              </td>
            </tr>
          }
        </tbody>
        <tfoot>
          <tr class="subtotal">
            <td>
              <button mat-button (click)="e.add()"><mat-icon>add</mat-icon> Add line</button>
            </td>
            <td class="num">Subtotal · الإجمالي قبل الخصم</td>
            <td class="num">{{ e.subtotal() | money }}</td>
            <td class="num muted">{{ e.lineDiscounts() > 0 ? (e.lineDiscounts() | money) : '' }}</td>
            <td colspan="3"></td>
          </tr>
          <tr class="invoice-discount">
            <td></td>
            <td class="num">Invoice discount · خصم الفاتورة</td>
            <td></td>
            <td class="num">
              <mat-form-field subscriptSizing="dynamic" class="discount">
                <span matTextPrefix>{{ company.currency() }}&nbsp;</span>
                <input matInput type="number" min="0" step="any" [ngModel]="e.discount()" (ngModelChange)="e.discount.set($event); e.touch()"
                  [attr.aria-label]="label() + 'Invoice discount'" [errorStateMatcher]="marked(label() + 'Invoice discount')" />
                <mat-error>{{ said(label() + 'Invoice discount') }}</mat-error>
              </mat-form-field>
            </td>
            <td colspan="3" class="muted hint">Shared among the lines by their totals · يُوزَّع على البنود</td>
          </tr>
          @if (e.totalDiscount() > 0) {
            <tr class="total-discount">
              <td></td>
              <td class="num">Total discount · إجمالي الخصم</td>
              <td class="num">− {{ e.totalDiscount() | money }}</td>
              <td colspan="4"></td>
            </tr>
          }
          <tr class="net-payable">
            <td></td>
            <td class="num">
              @if (e.totals().expenses > 0) {
                <span class="split">Stock · مخزون</span>
                <span class="split">Expenses · مصروفات</span>
              }
              Net payable · الصافي المستحق
            </td>
            <td class="num">
              @if (e.totals().expenses > 0) {
                <span class="split">{{ e.totals().stock | money }}</span>
                <span class="split">{{ e.totals().expenses | money }}</span>
              }
              {{ e.total() | money }}
            </td>
            <td colspan="4"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `,
  styleUrl: './costing.scss',
  styles: `
    .material {
      min-width: 216px;
      width: 100%;
    }
    .price-alert {
      display: flex;
      align-items: flex-start;
      gap: 4px;
      margin-top: 4px;
      padding: 4px 8px;
      max-width: 220px;
      margin-inline-start: auto;
      border-radius: 8px;
      background: color-mix(in srgb, var(--app-warn) 16%, transparent);
      color: var(--app-warn);
      font: var(--mat-sys-label-small);
      text-align: start;
      white-space: normal;

      mat-icon {
        flex: none;
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
      span {
        display: block;
      }
      .en {
        opacity: 0.85;
      }
    }
    .add-new {
      color: var(--mat-sys-primary);
      font-weight: 500;
    }
    /* Seven columns of fields side by side: kept tight, so a laptop's screen holds them all. */
    .grid th,
    .grid td {
      padding-inline: 8px;
    }
    .small {
      width: 112px;
    }
    .discount {
      width: 112px;
    }
    .quantity {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }
    .unit {
      width: 96px;
    }
    .warn-text {
      color: var(--mat-sys-error);
    }
    .badge.expense {
      margin: 4px 0 0;
      display: inline-block;
      background: color-mix(in srgb, var(--app-warn) 16%, transparent);
      color: var(--app-warn);
    }
    .category {
      white-space: nowrap;
    }
    .split {
      display: block;
      font-weight: 400;
      color: var(--mat-sys-on-surface-variant);
    }
    .share {
      display: block;
      max-width: 112px;
      margin-inline-start: auto;
      white-space: normal;
    }
    .net {
      display: block;
      color: var(--app-slate-700, #334155);
      font-weight: 600;
      white-space: nowrap;
    }
    tfoot tr:not(.net-payable) td {
      font-weight: 400;
      border-bottom: none;
    }
    tfoot .hint {
      font-size: 12px;
      text-align: start;
    }
    tfoot .net-payable td {
      font-weight: 700;
    }
  `,
})
export class InvoiceLinesTable {
  protected readonly company = inject(Company);
  readonly editor = input.required<InvoiceLines>();
  // Before each field's accessible name, to tell one invoice's from another's: "Invoice 2, ".
  readonly label = input('');
  // The screen's checks, which mark a field once a send is refused for what it is missing.
  readonly checks = input<FormChecks | null>(null);

  protected marked(field: string): ErrorStateMatcher {
    return this.checks()?.field(field) ?? defaultMatcher;
  }

  protected said(field: string): string {
    return this.checks()?.message(field) ?? '';
  }
}
