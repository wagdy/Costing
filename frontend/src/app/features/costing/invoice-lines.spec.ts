import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { CostingApi, MaterialCost, PurchaseInvoiceLine } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { InvoiceLine, InvoiceLines, InvoiceLinesTable, PurchaseCatalog } from './invoice-lines';

const tomatoes = { id: 'tomatoes', name: 'Tomatoes', unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000, kind: 'Purchased' } as MaterialCost;
const oil = { id: 'oil', name: 'Frying oil', unit: 'Millilitre', purchaseUnit: 'L', purchaseUnitSize: 1000, kind: 'Purchased' } as MaterialCost;

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

@Component({
  imports: [InvoiceLinesTable],
  providers: [PurchaseCatalog],
  template: `<app-invoice-lines [editor]="editor" />`,
})
class Host {
  readonly catalog = inject(PurchaseCatalog);
  readonly editor = new InvoiceLines(this.catalog);
}

// A receipt with discounts (الخصم): each line's own beside its total, and the invoice's own in the
// footer, shared among the priced lines as the server shares it. What is paid, and what each
// costs a unit, are after both.
describe('an invoice’s discounts', () => {
  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: CostingApi, useValue: { materials: () => of([tomatoes, oil]), suppliers: () => of([]), expenseItems: () => of([]) } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    await fixture.componentInstance.catalog.load();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, editor: fixture.componentInstance.editor };
  }

  function line(material: MaterialCost, quantity: number, cost: number | null, discount = 0): InvoiceLine {
    return { entry: material, itemType: 'Inventory', rawMaterialId: material.id, expenseItemId: null, quantity, unitSize: null, unitLabel: '', cost, discount };
  }

  it('come off each line and the invoice: the net is what is paid and what a unit costs', async () => {
    const { fixture, el, editor } = await render();
    editor.lines.set([line(tomatoes, 5, 100, 10), line(oil, 10, 400)]);
    editor.discount.set(30);
    editor.touch();
    fixture.detectChanges();

    // 90 and 400 after the tomatoes' own: 30 off them is 5.51 and 24.49, to the piastre.
    const [t, o] = editor.lines();
    expect([editor.share(t), editor.share(o)]).toEqual([5.51, 24.49]);
    expect([editor.netCost(t), editor.netCost(o)]).toEqual([84.49, 375.51]);
    expect([editor.subtotal(), editor.lineDiscounts(), editor.totalDiscount(), editor.total()]).toEqual([500, 10, 40, 460]);
    expect(editor.totals()).toEqual({ stock: 460, expenses: 0 });
    // 84.49 for 5 kg: 16.90 a kg, not the 20 written on the paper.
    expect(editor.unitPrice(t)).toBeCloseTo(16.898, 3);

    expect(text(el.querySelector('thead')!)).toContain('Line totalإجمالي السطرDiscountالخصمAP$ per purchase unit');
    expect(text(el.querySelector('tbody tr')!)).toContain('Net · الصافي L.E 84.49');
    // Subtotal − total discount = net payable, each under its column.
    const cells = (row: Element) => [...row.querySelectorAll('td')].map(text).filter(Boolean).join(' | ');
    expect([...el.querySelectorAll('tfoot tr')].map(cells)).toEqual([
      'add Add line | Subtotal · الإجمالي قبل الخصم | L.E 500.00 | L.E 10.00',
      'Invoice discount · خصم الفاتورة | L.E | Shared among the lines by their totals · يُوزَّع على البنود',
      'Total discount · إجمالي الخصم | − L.E 40.00',
      'Net payable · الصافي المستحق | L.E 460.00',
    ]);

    expect(editor.toSave().map((l) => [l.cost, l.discount])).toEqual([
      [100, 10],
      [400, 0],
    ]);
  });

  it('with none, is the total as it always was', async () => {
    const { fixture, el, editor } = await render();
    editor.lines.set([line(tomatoes, 5, 100)]);
    editor.touch();
    fixture.detectChanges();

    expect([editor.total(), editor.unitPrice(editor.lines()[0])]).toEqual([100, 20]);
    expect(el.querySelector('tfoot .total-discount')).toBeNull();
    expect(text(el.querySelector('tfoot .net-payable')!)).toBe('Net payable · الصافي المستحق L.E 100.00');
  });

  it('is never more than what it comes off, and is said by its field', async () => {
    const { editor } = await render();
    const problems = () => editor.problems('Invoice 1, ').map((p) => `${p.field}: ${p.what}`);

    editor.lines.set([line(tomatoes, 5, 100, 100.01), line(oil, 1, null, 5)]);
    editor.discount.set(-1);
    editor.touch();
    expect(problems()).toEqual([
      'Invoice 1, Discount, line 1: the discount cannot be more than the line total',
      'Invoice 1, Discount, line 2: enter the line total before its discount',
      'Invoice 1, Invoice discount: it cannot be below 0',
    ]);

    // 100 less 40 own: 60 left, so 60.01 off the invoice is too much.
    editor.lines.set([line(tomatoes, 5, 100, 40)]);
    editor.discount.set(60.01);
    editor.touch();
    expect(problems()).toEqual(['Invoice 1, Invoice discount: it cannot be more than the lines come to']);
    // Not shared while it is: the total stands.
    expect(editor.total()).toBe(60);

    editor.discount.set(60);
    editor.touch();
    expect([problems(), editor.total()]).toEqual([[], 0]);
  });

  it('comes back as written when a saved invoice is opened again, and is kept back from a draft held only for its paper', async () => {
    const { editor } = await render();
    editor.fill(
      [
        {
          rawMaterialId: 'tomatoes', material: 'Tomatoes', unit: 'Gram', enteredQuantity: 5, unitLabel: 'kg', unitSize: 1000, quantity: 5000,
          cost: 84.49, lineTotal: 100, discount: 10, discountShare: 5.51, itemType: 'Inventory', expenseItemId: null,
          categoryId: null, category: null, categoryAr: null,
        } satisfies PurchaseInvoiceLine,
      ],
      30,
    );
    expect(editor.lines()[0]).toMatchObject({ cost: 100, discount: 10 });
    expect(editor.discount()).toBe(30);

    // An unfinished line with too much off it, and the invoice's more than the rest: sent without them.
    editor.lines.update((lines) => [...lines, line(oil, 1, 20, 25)]);
    editor.discount.set(200);
    editor.touch();
    expect(editor.toSave(true).map((l) => l.discount)).toEqual([10, 0]);
    expect(editor.discountToSave(true)).toBe(0);
    expect(editor.discountToSave()).toBe(200);

    editor.reset();
    expect([editor.discount(), editor.lines()[0].discount]).toEqual([0, 0]);
  });

  it('is entered by keyboard: Enter goes from the line total to its discount, then to a new line; the footer keeps its Enter', async () => {
    const { fixture, el, editor } = await render();
    document.body.appendChild(el);
    const field = (label: string) => el.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    const enter = (target: HTMLElement) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    field('Item, line 1').focus();
    enter(field('Item, line 1'));
    expect(document.activeElement).toBe(field('Quantity, line 1'));
    enter(field('Quantity, line 1'));
    expect(document.activeElement).toBe(field('Line total, line 1'));
    enter(field('Line total, line 1'));
    expect(document.activeElement).toBe(field('Discount, line 1'));

    enter(field('Discount, line 1'));
    await fixture.whenStable();
    fixture.detectChanges();
    await vi.waitFor(() => expect(document.activeElement).toBe(field('Item, line 2')));
    expect(editor.lines()).toHaveLength(2);

    field('Invoice discount').focus();
    enter(field('Invoice discount'));
    expect(document.activeElement).toBe(field('Invoice discount'));
    expect(editor.lines()).toHaveLength(2);
    el.remove();
  });
});

// The price guardrail (تنبيه السعر): a line's price per purchase unit more than 25% from the
// material's average now is flagged where it is typed, most often a quantity in the wrong unit. It
// warns; the invoice is still saved as entered.
describe('an invoice line’s price against the average', () => {
  const pricedTomatoes = { ...tomatoes, costPerPurchaseUnit: 20 } as MaterialCost;
  const unpricedOil = { ...oil, costPerPurchaseUnit: null } as MaterialCost;

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: CostingApi, useValue: { materials: () => of([pricedTomatoes, unpricedOil]), suppliers: () => of([]), expenseItems: () => of([]) } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: NotifyService, useValue: { info: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    await fixture.componentInstance.catalog.load();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, editor: fixture.componentInstance.editor };
  }

  function line(material: MaterialCost, quantity: number, cost: number | null): InvoiceLine {
    return { entry: material, itemType: 'Inventory', rawMaterialId: material.id, expenseItemId: null, quantity, unitSize: null, unitLabel: '', cost, discount: 0 };
  }

  it('flags a price more than 25% either way from the average now, and lets the invoice be saved', async () => {
    const { fixture, el, editor } = await render();
    // 5 kg for 150: 30 a kg against 20, +50%; 5 kg for 110: 22, +10%; 5 kg for 50: 10, −50%.
    editor.lines.set([line(pricedTomatoes, 5, 150), line(pricedTomatoes, 5, 110), line(pricedTomatoes, 5, 50), line(unpricedOil, 10, 400)]);
    editor.touch();
    fixture.detectChanges();

    expect(editor.lines().map((l) => editor.priceDeviation(l))).toEqual([50, null, -50, null]);
    const alerts = [...el.querySelectorAll('tbody tr')].map((r) => r.querySelector('.price-alert'));
    expect(alerts.map((a) => (a ? [text(a.querySelector('[lang="ar"]')!), text(a.querySelector('.en')!)] : null))).toEqual([
      ['تنبيه: السعر يختلف بـ +50% عن المتوسط الحالي - تأكد من الوحدة!', '+50% from the average now: check the unit.'],
      null,
      ['تنبيه: السعر يختلف بـ -50% عن المتوسط الحالي - تأكد من الوحدة!', '-50% from the average now: check the unit.'],
      null,
    ]);
    expect(alerts[0]!.getAttribute('role')).toBe('status');
    // Never in the way: every line goes as entered.
    expect(editor.toSave().map((l) => l.cost)).toEqual([150, 110, 50, 400]);
  });

  it('says nothing within 25%, or with no price to compare', async () => {
    const { fixture, el, editor } = await render();
    editor.lines.set([line(pricedTomatoes, 4, 100), line(pricedTomatoes, 5, null)]);
    editor.touch();
    fixture.detectChanges();
    // 25 a kg is +25% exactly: within.
    expect(editor.lines().map((l) => editor.priceDeviation(l))).toEqual([null, null]);
    // 5000 typed for 5 kg: 0.025 a kg, −99.9%, not −100%.
    editor.lines.set([line(pricedTomatoes, 5000, 125)]);
    expect(editor.priceDeviation(editor.lines()[0])).toBe(-99.9);
    expect(el.querySelector('.price-alert')).toBeNull();
  });
});

