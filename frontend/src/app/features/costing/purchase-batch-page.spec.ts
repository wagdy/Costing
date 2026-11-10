import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CostingApi, MaterialCost, PurchaseBatch, PurchaseInvoice, Supplier, SupplierBalance } from '../../core/costing/costing.api';
import { CostingAccess, CostingTab } from '../../core/costing/costing-tabs';
import { EndOfDay, EndOfDayApi, EndOfDayInvoice } from '../../core/costing/end-of-day.api';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { PurchaseBatchPage } from './purchase-batch-page';

const tomatoes = { id: 'tomatoes', name: 'Tomatoes', unit: 'Gram', purchaseUnit: 'kg', purchaseUnitSize: 1000, kind: 'Purchased' } as MaterialCost;
const milk = { id: 'milk', name: 'Milk', unit: 'Millilitre', purchaseUnit: 'L', purchaseUnitSize: 1000, kind: 'Purchased' } as MaterialCost;
const nile = { id: 'nile', name: 'Nile Farms' } as Supplier;
const delta = { id: 'delta', name: 'Delta Dairy' } as Supplier;
// Nile Farms is owed 1,000 from before; Delta Dairy nothing.
const balances = [
  { supplierId: 'nile', supplier: 'Nile Farms', balance: 1_000 },
  { supplierId: 'delta', supplier: 'Delta Dairy', balance: 0 },
] as SupplierBalance[];

function posted(id: string, supplier: Supplier, total: number, paymentStatus: PurchaseInvoice['paymentStatus']): PurchaseInvoice {
  return { id, supplierId: supplier.id, supplierName: supplier.name, supplierInvoiceNumber: null, total, paymentStatus } as PurchaseInvoice;
}

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('a day’s purchases entered together', () => {
  const postPurchaseBatch = vi.fn();
  const attachPurchaseInvoiceFile = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  const approvals = { canApprove: vi.fn(() => true), refresh: vi.fn() };
  // The end of day of each date: none unless a test hands one in.
  const endOfDay = { day: vi.fn(), photo: vi.fn() };

  // financials: signed in as someone who works Financials, who may advance employees in the batch.
  async function render(financials = false) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { me: () => null, can: () => true } },
        { provide: CostingAccess, useValue: { has: (tab: CostingTab) => financials || tab !== 'Financials' } },
        {
          provide: MenuSalesApi,
          useValue: {
            staff: () => of([
              { id: 'hassan', name: 'Hassan', jobTitle: 'Chef', isActive: true },
              { id: 'old', name: 'Gone', jobTitle: 'Waiter', isActive: false },
            ] as Employee[]),
          },
        },
        {
          provide: CostingApi,
          useValue: {
            materials: () => of([tomatoes, milk]),
            suppliers: () => of([nile, delta]),
            expenseItems: () => of([]),
            businessToday: () => of({ today: '2026-10-13' }),
            supplierBalances: () => of(balances),
            postPurchaseBatch,
            attachPurchaseInvoiceFile,
          },
        },
        { provide: Approvals, useValue: approvals },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: EndOfDayApi, useValue: endOfDay },
      ],
    });
    const fixture = TestBed.createComponent(PurchaseBatchPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  // An invoice of the batch filled in: its supplier, and one line.
  function fill(block: Record<string, any>, supplier: Supplier | null, material: MaterialCost, quantity: number, cost: number) {
    block['supplier'].entered(supplier);
    block['editor'].lines.set([{ itemType: 'Inventory', rawMaterialId: material.id, expenseItemId: null, quantity, unitSize: 1000, unitLabel: '', cost }]);
    block['editor'].touch();
  }

  beforeEach(() => {
    localStorage.removeItem('otantik-till.purchase-batch');
    postPurchaseBatch.mockReset();
    attachPurchaseInvoiceFile.mockReset();
    notify.info.mockReset();
    approvals.canApprove.mockReturnValue(true);
    endOfDay.day.mockReset().mockReturnValue(of(null));
    endOfDay.photo.mockReset().mockReturnValue(of(new Blob(['x'], { type: 'image/jpeg' })));
    URL.createObjectURL = vi.fn(() => 'blob:photo');
    URL.revokeObjectURL = vi.fn();
  });

  it('never greys out Submit batch: clicked with something missing, it sends nothing, marks each field and says what', async () => {
    const { fixture, el, page } = await render();
    notify.error.mockReset();
    // Invoice 1 has its supplier but no quantity; invoice 2 nothing; a payment with no amount.
    fill(page['blocks']()[0], nile, tomatoes, 5, 100);
    page['blocks']()[0].editor.lines()[0].quantity = null;
    page['addBlock']();
    page['addPayment']();
    page['payments']()[0].supplierId = 'nile';
    page['changed']();
    fixture.detectChanges();
    const submit = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Submit batch'))!;
    expect(submit.disabled).toBe(false);

    submit.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(postPurchaseBatch).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(
      null,
      'Cannot submit. Paid: choose how they were paid. Invoice 1, line 1: enter the quantity. Invoice 2, line 1: choose the item. ' +
        'And 2 more, marked in red.',
    );
    expect([...el.querySelectorAll('mat-error')].map(text)).toEqual([
      'Choose how they were paid', 'Enter the quantity', 'Choose the item', 'Enter the quantity', 'Enter the amount',
    ]);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('How they are paid');
    expect(el.querySelector('[aria-label="Supplier payment 1, amount"]')!.closest('mat-form-field')!.classList).toContain('mat-form-field-invalid');

    // Put right, it goes.
    page['blocks']()[0].editor.lines()[0].quantity = 5;
    page['blocks']()[0].editor.touch();
    page['removeBlock'](1);
    page['payments']()[0].amount = 300;
    page['paymentMethod'] = 'Safe';
    page['changed']();
    fixture.detectChanges();
    expect(el.querySelectorAll('mat-error').length).toBe(0);
    postPurchaseBatch.mockReturnValue(of({ invoices: [posted('i1', nile, 100, 'Paid')], payments: [] }));
    submit.click();
    await fixture.whenStable();
    expect(postPurchaseBatch).toHaveBeenCalledTimes(1);
  });

  it('unmarks everything when the batch is started again', async () => {
    const { fixture, el, page } = await render();
    await page['submit']();
    fixture.detectChanges();
    expect(el.querySelectorAll('mat-error').length).toBeGreaterThan(0);

    page['startAgain']();
    fixture.detectChanges();
    expect(el.querySelectorAll('mat-error').length).toBe(0);
  });

  it('is sent only once each invoice is ready and the payment chosen, every one with its supplier on credit', async () => {
    const { page } = await render();

    expect(page['invoiceDate']).toBe('2026-10-13');
    fill(page['blocks']()[0], nile, tomatoes, 5, 100);
    page['addBlock']();
    fill(page['blocks']()[1], null, milk, 10, 420);
    expect(page['ready']()).toBe(false);

    page['paymentMethod'] = 'Safe';
    page['changed']();
    expect(page['ready']()).toBe(true);

    // On credit, each is owed to someone: the second needs its supplier.
    page['paymentMethod'] = 'Credit';
    page['changed']();
    expect(page['ready']()).toBe(false);
    page['blocks']()[1]['supplier'].entered(delta);
    expect(page['ready']()).toBe(true);
    expect(page['total']()).toBe(520);
  });

  it('sends each invoice with its own id and supplier, shows what was posted, and starts again', async () => {
    const { fixture, el, page } = await render();
    approvals.canApprove.mockReturnValue(false);
    page['paymentMethod'] = 'Safe';
    fill(page['blocks']()[0], nile, tomatoes, 5, 100);
    page['blocks']()[0]['number'] = ' F-1 ';
    page['addBlock']();
    fill(page['blocks']()[1], delta, milk, 10, 420);
    page['changed']();
    const ids = page['blocks']().map((b: Record<string, any>) => b['id']);
    postPurchaseBatch.mockReturnValue(of({ invoices: [posted(ids[0], nile, 100, 'Pending'), posted(ids[1], delta, 420, 'Pending')], payments: [] }));

    await page['submit']();

    const sent = postPurchaseBatch.mock.lastCall![0] as PurchaseBatch;
    expect(sent).toMatchObject({ invoiceDate: '2026-10-13', paymentMethod: 'Safe', revenueDate: null });
    expect(sent.invoices.map((i) => [i.invoiceId, i.supplierId, i.supplierInvoiceNumber, i.lines.length])).toEqual([
      [ids[0], 'nile', 'F-1', 1],
      [ids[1], 'delta', null, 1],
    ]);
    expect(sent.invoices[1].lines[0]).toMatchObject({ itemType: 'Inventory', rawMaterialId: 'milk', enteredQuantity: 10, unitSize: 1000, unitLabel: 'L', cost: 420 });
    expect(notify.info).toHaveBeenCalledWith("2 invoices posted. 2 payments wait for a manager's approval.");

    fixture.detectChanges();
    expect([...el.querySelectorAll('.posted tbody tr')].map((r) => text(r.querySelector('td')!))).toEqual(['Nile Farms', 'Delta Dairy']);
    // A new batch: one empty invoice, a new id.
    expect(page['blocks']().length).toBe(1);
    expect(ids).not.toContain(page['blocks']()[0]['id']);
  });

  it('keeps the batch when it is refused, and says each problem by its invoice', async () => {
    const { fixture, el, page } = await render();
    page['paymentMethod'] = 'Credit';
    fill(page['blocks']()[0], nile, tomatoes, 5, 100);
    page['changed']();
    const refused = 'Invoice 1 · Nile Farms: Tomatoes has been deleted from the raw materials.\nInvoice 2: It has no lines.';
    postPurchaseBatch.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { errors: [refused] } })));

    await page['submit']();
    fixture.detectChanges();

    expect(el.querySelector('.problems')!.textContent).toBe(refused);
    expect(page['blocks']()[0]['editor'].lines()[0].rawMaterialId).toBe('tomatoes');
  });

  it('comes back as it was after a reload, until it is sent', async () => {
    const first = await render();
    first.page['paymentMethod'] = 'DayRevenue';
    fill(first.page['blocks']()[0], nile, tomatoes, 5, 100);
    first.page['changed']();
    first.fixture.detectChanges();
    const id = first.page['blocks']()[0]['id'];
    TestBed.resetTestingModule();

    const { page } = await render();
    expect(page['paymentMethod']).toBe('DayRevenue');
    const block = page['blocks']()[0];
    expect([block['id'], block['supplier'].id, block['editor'].lines()[0].rawMaterialId, block['editor'].lines()[0].entry]).toEqual([
      id, 'nile', 'tomatoes', tomatoes,
    ]);
  });

  it('pays a supplier in the batch: no lines, only the supplier owed, the amount and notes; never more than owed', async () => {
    const { fixture, el, page } = await render();
    page['paymentMethod'] = 'DayRevenue';
    page['changed']();

    // The empty invoice the batch starts with goes: a batch of payments alone.
    page['addPayment']();
    fixture.detectChanges();
    expect(page['blocks']().length).toBe(0);
    const block = el.querySelector('.payment-block')!;
    expect(block.querySelector('app-invoice-lines')).toBeNull();
    expect([...block.querySelectorAll('mat-label')].map(text)).toEqual(['Supplier · المورد', 'Payment amount · قيمة السداد', 'Notes / receipt no. · ملاحظات']);
    // Only those owed something can be paid.
    expect(page['owedSuppliers']().map((b: SupplierBalance) => b.supplier)).toEqual(['Nile Farms']);

    const pay = page['payments']()[0];
    pay.supplierId = 'nile';
    pay.amount = 600;
    pay.notes = ' Receipt R-12 ';
    page['changed']();
    expect([page['owedBefore'](0), page['ready']()]).toEqual([1_000, true]);
    // Two together more than owed: the second is over.
    page['addPayment']();
    Object.assign(page['payments']()[1], { supplierId: 'nile', amount: 500 });
    page['changed']();
    fixture.detectChanges();
    expect([page['owedBefore'](1), page['ready']()]).toEqual([400, false]);
    expect(page['missing']()).toEqual([
      { where: 'Supplier payment 2', what: 'it is more than they are owed', field: 'Supplier payment 2, amount' },
    ]);
    expect(text(el.querySelectorAll('.payment-block')[1])).toContain('Owed L.E 400.00 after the payments above');
    page['payments']()[1].amount = 400;
    page['changed']();
    expect(page['ready']()).toBe(true);
    expect(page['countLabel']()).toBe('2 payments');
  });

  it('sends the payments with the batch, from the day’s takings, and shows what was paid', async () => {
    const { fixture, el, page } = await render();
    page['paymentMethod'] = 'DayRevenue';
    fill(page['blocks']()[0], nile, tomatoes, 5, 100);
    page['addPayment']();
    Object.assign(page['payments']()[0], { supplierId: 'nile', amount: 600, notes: ' Receipt R-12 ' });
    page['changed']();
    const id = page['payments']()[0].id;
    postPurchaseBatch.mockReturnValue(of({
      invoices: [posted(page['blocks']()[0].id, nile, 100, 'Paid')],
      payments: [{ transactionId: id, supplierId: 'nile', supplier: 'Nile Farms', amount: 600, notes: 'Receipt R-12', outcome: 'Applied' }],
    }));

    await page['submit']();
    fixture.detectChanges();

    const sent = postPurchaseBatch.mock.lastCall![0] as PurchaseBatch;
    expect(sent).toMatchObject({ paymentMethod: 'DayRevenue', revenueDate: '2026-10-13' });
    expect(sent.payments).toEqual([{ transactionId: id, supplierId: 'nile', amount: 600, notes: 'Receipt R-12' }]);
    expect(sent.invoices.length).toBe(1);
    expect(notify.info).toHaveBeenCalledWith('1 invoice posted, 1 supplier paid.');
    expect([...el.querySelectorAll('.payments-made tbody td')].map(text)).toEqual(['Nile Farms', 'Receipt R-12', 'L.E 600.00', 'Paidتم السداد']);
    expect(page['payments']()).toEqual([]);
  });

  it('pays no supplier on credit', async () => {
    const { fixture, el, page } = await render();
    // As choosing it in the list does: the page marked for a fresh look.
    page['paymentMethod'] = 'Credit';
    page['changed']();
    fixture.componentRef.changeDetectorRef.markForCheck();
    await fixture.whenStable();

    const add = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).startsWith('payments Add supplier payment'))!;
    expect(add.disabled).toBe(true);
    // Once there are payments, the batch cannot be put on credit either.
    page['paymentMethod'] = 'Safe';
    page['addPayment']();
    page['paymentMethod'] = 'Credit';
    page['changed']();
    Object.assign(page['payments']()[0], { supplierId: 'nile', amount: 100 });
    expect(page['ready']()).toBe(false);
  });

  it('advances an employee in the batch, from the day’s takings, and shows it was paid', async () => {
    const { fixture, el, page } = await render(true);
    const add = () => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).startsWith('request_quote Add employee advance'));
    expect(add()).toBeTruthy();

    page['addAdvance']();
    fixture.detectChanges();
    // The empty invoice the batch starts with goes: a batch of advances alone can be sent.
    expect(page['blocks']().length).toBe(0);
    expect(page['employees']().map((e: Employee) => e.name)).toEqual(['Hassan']);
    expect(page['missing']().map((p: { where: string; what: string }) => `${p.where}: ${p.what}`)).toEqual([
      'Paid: choose how they were paid',
      'Advance 1: enter the amount',
    ]);

    page['paymentMethod'] = 'DayRevenue';
    Object.assign(page['advances']()[0], { employeeId: 'hassan', amount: 300, notes: ' Rent ' });
    page['changed']();
    expect(page['countLabel']()).toBe('1 advance');
    const id = page['advances']()[0].id;
    postPurchaseBatch.mockReturnValue(of({
      invoices: [],
      payments: [],
      advances: [{ transactionId: id, employeeId: 'hassan', employee: 'Hassan', amount: 300, notes: 'Rent', outcome: 'Applied' }],
    }));

    await page['submit']();
    fixture.detectChanges();

    const sent = postPurchaseBatch.mock.lastCall![0] as PurchaseBatch;
    expect(sent).toMatchObject({ paymentMethod: 'DayRevenue', revenueDate: '2026-10-13', invoices: [], payments: [] });
    expect(sent.advances).toEqual([{ transactionId: id, employeeId: 'hassan', amount: 300, notes: 'Rent' }]);
    expect(notify.info).toHaveBeenCalledWith('1 advance paid.');
    expect([...el.querySelectorAll('.payments-made tbody td')].map(text)).toEqual(['Hassan', 'Rent', 'L.E 300.00', 'Paid, off their payصُرفت']);
    expect(page['advances']()).toEqual([]);
  });

  it('advances no one on credit, and offers no advance to whoever does not work Financials', async () => {
    const { page } = await render(true);
    page['addAdvance']();
    Object.assign(page['advances']()[0], { employeeId: 'hassan', amount: 100 });
    page['paymentMethod'] = 'Credit';
    page['changed']();
    expect(page['missing']()[0]).toMatchObject({ where: 'Paid', what: "advances are cash: choose the safe or a day's takings" });
    TestBed.resetTestingModule();

    const other = await render(false);
    expect([...other.el.querySelectorAll('button')].map(text).some((t) => t.includes('Add employee advance'))).toBe(false);
  });

  // A receipt's discounts and its paper (إرفاق الفاتورة), per invoice of the batch: the discounts go
  // with it, and the paper is attached once it is posted, kept with it in the archive.
  describe('invoices handed in at the end of the day', () => {
    const handedIn = (id: string, kind: 'Cash' | 'Credit', supplier: Supplier, total: number, purchaseInvoiceId: string | null = null): EndOfDayInvoice => ({
      id, kind, supplierId: supplier.id, supplier: supplier.name, reportedTotal: total, note: kind === 'Credit' ? 'Pay Thursday' : null,
      photo: { fileName: `${id}.jpg`, contentType: 'image/jpeg', bytes: 900 }, addedAtUtc: '2026-10-13T20:00:00Z', purchaseInvoiceId, postedAtUtc: null,
    });
    // The 13th: a cash invoice and one on credit to post, and a cash one posted already.
    const closed = {
      id: 'day-13', date: '2026-10-13', status: 'Submitted', cashAmount: 3_000, cardAmount: 1_000, taxAmount: 560, voidsAmount: 0, notes: null, salesPhoto: null,
      invoices: [handedIn('h1', 'Cash', nile, 400), handedIn('h2', 'Credit', delta, 1_280), handedIn('h3', 'Cash', nile, 50, 'p-old')],
      cashInvoices: 2, cashInvoicesTotal: 450, creditInvoices: 1, creditInvoicesTotal: 1_280, netSales: 4_000, totalRevenue: 4_560,
      cashAfterInvoices: 2_550, expectedIntoSafe: 4_110, posted: 1, takingsEntered: null, createdBy: 'Hany', createdAtUtc: '', updatedBy: 'Hany', updatedAtUtc: '',
      submittedBy: 'Hany', submittedAtUtc: '2026-10-13T21:00:00Z', reopenedBy: null, reopenedAtUtc: null,
      openingFloat: null, payouts: [], supplierPayments: 0, supplierPaymentsTotal: 0, advances: 0, advancesTotal: 0,
      cashTax: 420, cashSalesCollected: 3_420, cashPaidOut: 450, netCashInTill: 2_970,
    } satisfies EndOfDay;

    it('opens the date as its invoices: each with its supplier, paid as handed in, its photo above its lines, and its total matched', async () => {
      endOfDay.day.mockImplementation((date: string) => of(date === '2026-10-13' ? closed : null));
      const { fixture, el, page } = await render();
      fixture.detectChanges();

      expect(text(el.querySelector('.handed-in')!)).toBe(
        'assignment_turned_inEnd of day of Tue 13 Oct handed in تقفيل اليوم 2 cash (L.E 450.00) · 1 on credit (L.E 1,280.00) · by Hany. ' +
          '2 to post below, each with its photo; 1 posted already. Open · فتح',
      );
      const blocks = page['blocks']();
      expect(blocks.map((b: Record<string, any>) => [b['supplier'].id, b['credit'], b['handedIn'].invoiceId])).toEqual([['nile', false, 'h1'], ['delta', true, 'h2']]);
      // Paid as not chosen yet: out of that day's takings.
      expect([page['paymentMethod'], page['revenueDate']]).toEqual(['DayRevenue', '2026-10-13']);
      expect(el.querySelectorAll('section.block app-photo-viewer').length).toBe(2);
      expect([...el.querySelectorAll('section.block .mat-button-toggle-checked')].map(text)).toEqual(['Cash · نقدي', 'On credit · آجل']);
      expect(text(el.querySelector('.handed-note')!)).toBe('sticky_note_2 Pay Thursday');
      expect(text(el.querySelector('.reported')!)).toBe('Reported · المُبلغ: L.E 400.00L.E 400.00 to go · متبقي');

      fill(blocks[0], nile, tomatoes, 5, 400);
      fill(blocks[1], delta, milk, 4, 1_300);
      fixture.detectChanges();
      const [first, second] = [...el.querySelectorAll('.reported')];
      expect([text(first), first.classList.contains('matched')]).toEqual(['Reported · المُبلغ: L.E 400.00check_circle Matched · مطابق', true]);
      expect(text(second)).toBe('Reported · المُبلغ: L.E 1,280.00L.E 20.00 over · زيادة');

      postPurchaseBatch.mockReturnValue(of({ invoices: [posted('i1', nile, 400, 'Paid'), posted('i2', delta, 1_300, 'OnCredit')], payments: [] }));
      await page['submit']();
      const sent = postPurchaseBatch.mock.lastCall![0] as PurchaseBatch;
      expect([sent.paymentMethod, sent.revenueDate]).toEqual(['DayRevenue', '2026-10-13']);
      expect(sent.invoices.map((i) => [i.supplierId, i.onCredit, i.endOfDayInvoiceId])).toEqual([['nile', false, 'h1'], ['delta', true, 'h2']]);
      // Its photo is its paper already: nothing to attach.
      expect(attachPurchaseInvoiceFile).not.toHaveBeenCalled();
    });

    it('is posted with the date it was handed in on, and an invoice on credit needs its supplier', async () => {
      endOfDay.day.mockImplementation((date: string) => of(date === '2026-10-13' ? closed : null));
      const { page } = await render();
      const [cash] = page['blocks']();
      fill(cash, nile, tomatoes, 5, 400);
      page['removeBlock'](1);
      page['invoiceDate'] = '2026-10-12';
      page['dateChosen']();
      await Promise.resolve();

      expect(page['missing']()).toContainEqual({ where: 'Invoice 1', what: 'it was handed in on 2026-10-13: post it with that date', field: 'Invoice date' });
      // Another invoice, put on credit with no supplier.
      page['addBlock']();
      const added = page['blocks']()[1];
      page['payAs'](added, 'Credit');
      expect(page['missing']()).toContainEqual({ where: 'Invoice 2', what: 'on credit, choose who it is owed to', field: 'Invoice 2, supplier' });
    });

    it('waits for a day not submitted yet, and says so', async () => {
      endOfDay.day.mockReturnValue(of({ ...closed, status: 'Draft', submittedBy: null }));
      const { fixture, el, page } = await render();
      fixture.detectChanges();

      expect(text(el.querySelector('.handed-in')!)).toBe(
        'assignment_turned_inThe end of day of this date is not submitted yet لم يتم إرسال تقفيل هذا اليوم بعد3 invoices handed in so far: they come here once it is submitted.' +
          'Open · فتح',
      );
      expect(page['blocks']().every((b: Record<string, any>) => !b['handedIn'])).toBe(true);
    });
  });

  describe('discounts and papers', () => {
    const receipt = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'receipt.jpg', { type: 'image/jpeg' });

    // The file picker, as if a file had been chosen in it.
    function chosen(file: File): HTMLInputElement {
      const input = document.createElement('input');
      input.type = 'file';
      Object.defineProperty(input, 'files', { value: [file] });
      return input;
    }

    // Two invoices: Nile Farms', 100 less 10 and 5 off the invoice, with its paper; Delta Dairy's, as written.
    async function twoInvoices() {
      const rendered = await render();
      const { page } = rendered;
      page['paymentMethod'] = 'Credit';
      fill(page['blocks']()[0], nile, tomatoes, 5, 100);
      const first = page['blocks']()[0];
      first['editor'].lines()[0].discount = 10;
      first['editor'].discount.set(5);
      first['editor'].touch();
      page['choosePaper'](first, chosen(receipt));
      page['addBlock']();
      fill(page['blocks']()[1], delta, milk, 10, 420);
      page['changed']();
      const ids = page['blocks']().map((b: Record<string, any>) => b['id']);
      postPurchaseBatch.mockReturnValue(of({ invoices: [posted(ids[0], nile, 85, 'OnCredit'), posted(ids[1], delta, 420, 'OnCredit')], payments: [] }));
      return { ...rendered, ids };
    }

    it('sends each invoice with its discounts, and attaches its paper once it is posted', async () => {
      const { fixture, el, page, ids } = await twoInvoices();
      expect(page['total']()).toBe(505);
      fixture.detectChanges();
      expect(text(el.querySelector('.block .paper')!)).toBe('image receipt.jpgswap_horizclose');
      expect(text([...el.querySelectorAll('.block .paper')][1])).toBe('add_a_photo Attach the paper إرفاق الفاتورة');
      attachPurchaseInvoiceFile.mockImplementation((id: string) => of({ ...posted(id, nile, 85, 'OnCredit'), attachment: { fileName: 'receipt.jpg' } }));

      await page['submit']();

      const sent = postPurchaseBatch.mock.lastCall![0] as PurchaseBatch;
      expect(sent.invoices.map((i) => [i.discount, i.lines[0].cost, i.lines[0].discount])).toEqual([
        [5, 100, 10],
        [0, 420, 0],
      ]);
      expect(attachPurchaseInvoiceFile.mock.calls).toEqual([[ids[0], receipt]]);
      expect(notify.info).toHaveBeenCalledWith('2 invoices posted. 1 paper attached.');
      fixture.detectChanges();
      expect([...el.querySelectorAll('.posted tbody tr')].map((r) => text(r.querySelector('.paper-cell')!))).toEqual(['image receipt.jpg', '—']);
    });

    it('takes only a photo or a PDF under 10 MB, and keeps one that could not be sent to try again', async () => {
      const { fixture, el, page, ids } = await twoInvoices();
      notify.error.mockReset();
      const block = page['blocks']()[1];
      page['choosePaper'](block, chosen(new File(['notes'], 'notes.txt', { type: 'text/plain' })));
      expect(notify.error).toHaveBeenCalledWith(null, 'Attach a photo (JPEG, PNG or WebP) or a PDF of the invoice.');
      const huge = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
      Object.defineProperty(huge, 'size', { value: 10 * 1024 * 1024 + 1 });
      page['choosePaper'](block, chosen(huge));
      expect(notify.error).toHaveBeenLastCalledWith(null, 'The file must be under 10 MB.');
      expect(block['paper']).toBeNull();
      attachPurchaseInvoiceFile.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));

      await page['submit']();

      expect(notify.error).toHaveBeenLastCalledWith(null, '2 invoices posted. A paper could not be attached: try again below.');
      fixture.detectChanges();
      const row = el.querySelector('.posted tbody tr')!;
      expect(text(row.querySelector('.paper-cell')!)).toBe('receipt.jpg not attachedrefresh Try again');

      attachPurchaseInvoiceFile.mockImplementation((id: string) => of({ ...posted(id, nile, 85, 'OnCredit'), attachment: { fileName: 'receipt.jpg' } }));
      (row.querySelector('.paper-cell button') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(attachPurchaseInvoiceFile).toHaveBeenLastCalledWith(ids[0], receipt);
      expect(text(el.querySelector('.posted tbody tr .paper-cell')!)).toBe('image receipt.jpg');
    });

    it('keeps the discounts after a reload, but not the paper', async () => {
      const first = await twoInvoices();
      first.fixture.detectChanges();
      TestBed.resetTestingModule();

      const { page } = await render();
      const block = page['blocks']()[0];
      expect([block['editor'].lines()[0].discount, block['editor'].discount(), block['paper']]).toEqual([10, 5, null]);
    });
  });

  it('keeps the payments after a reload, until they are sent', async () => {
    const first = await render();
    first.page['paymentMethod'] = 'Safe';
    first.page['addPayment']();
    Object.assign(first.page['payments']()[0], { supplierId: 'nile', amount: 250, notes: 'R-7' });
    first.page['changed']();
    first.fixture.detectChanges();
    const id = first.page['payments']()[0].id;
    TestBed.resetTestingModule();

    const { page } = await render();
    expect(page['payments']()).toEqual([{ id, supplierId: 'nile', amount: 250, notes: 'R-7' }]);
    expect(page['blocks']().length).toBe(0);
  });
});
