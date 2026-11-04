import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CostingApi, Supplier } from '../../core/costing/costing.api';
import { CostingAccess, CostingTab } from '../../core/costing/costing-tabs';
import { EndOfDay, EndOfDayApi, EndOfDayInvoice, EndOfDayInvoiceKind } from '../../core/costing/end-of-day.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { EndOfDayPage, EndOfDaySummaryDialog, EodInvoiceForm } from './end-of-day-page';
import { Treasury } from './financials';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const nile = { id: 'nile', name: 'Nile Farms', contactPerson: 'Samy', phone: null } as Supplier;
const delta = { id: 'delta', name: 'Delta Dairy', contactPerson: null, phone: null } as Supplier;

function handedIn(id: string, kind: EndOfDayInvoiceKind, supplier: Supplier, total: number, extra: Partial<EndOfDayInvoice> = {}): EndOfDayInvoice {
  return {
    id, kind, supplierId: supplier.id, supplier: supplier.name, reportedTotal: total, note: null,
    photo: { fileName: `${id}.jpg`, contentType: 'image/jpeg', bytes: 1_000 }, addedAtUtc: '2026-11-04T18:00:00Z', purchaseInvoiceId: null, postedAtUtc: null,
    ...extra,
  };
}

// A day as the API gives it, its totals worked out from what it holds.
function day(over: Partial<EndOfDay> = {}): EndOfDay {
  const invoices = over.invoices ?? [];
  const sum = (kind: EndOfDayInvoiceKind) => invoices.filter((i) => i.kind === kind).reduce((s, i) => s + i.reportedTotal, 0);
  const [cash, card, tax] = [over.cashAmount ?? 0, over.cardAmount ?? 0, over.taxAmount ?? 0];
  return {
    id: 'day-1', date: '2026-11-04', status: 'Draft', cashAmount: null, cardAmount: null, taxAmount: null, voidsAmount: null, notes: null, salesPhoto: null,
    cashInvoices: invoices.filter((i) => i.kind === 'Cash').length, cashInvoicesTotal: sum('Cash'),
    creditInvoices: invoices.filter((i) => i.kind === 'Credit').length, creditInvoicesTotal: sum('Credit'),
    netSales: cash + card, totalRevenue: cash + card + tax, cashAfterInvoices: cash - sum('Cash'), expectedIntoSafe: cash + card + tax - sum('Cash'),
    posted: invoices.filter((i) => i.purchaseInvoiceId).length, takingsEntered: null,
    createdBy: 'Hany', createdAtUtc: '2026-11-04T18:00:00Z', updatedBy: 'Hany', updatedAtUtc: '2026-11-04T18:00:00Z',
    submittedBy: null, submittedAtUtc: null, reopenedBy: null, reopenedAtUtc: null,
    ...over,
    invoices,
  };
}

const threeInvoices = [
  handedIn('c1', 'Cash', nile, 400),
  handedIn('c2', 'Cash', delta, 960, { note: 'Cheese' }),
  handedIn('k1', 'Credit', delta, 1_280),
];

describe('the end of the day', () => {
  const api = {
    day: vi.fn(),
    days: vi.fn(),
    saveSales: vi.fn(),
    addInvoice: vi.fn(),
    changeInvoice: vi.fn(),
    replaceInvoicePhoto: vi.fn(),
    removeInvoice: vi.fn(),
    attachSalesPhoto: vi.fn(),
    removeSalesPhoto: vi.fn(),
    submit: vi.fn(),
    reopen: vi.fn(),
    photo: vi.fn(),
  };
  const open = vi.fn();
  const enter = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  let tabs: CostingTab[] = ['EndOfDay'];
  let manager = false;

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EndOfDayApi, useValue: api },
        { provide: CostingApi, useValue: { suppliers: () => of([nile, delta]), businessToday: () => of({ today: '2026-11-04' }) } },
        { provide: CostingAccess, useValue: { has: (tab: CostingTab) => tabs.includes(tab) } },
        { provide: Approvals, useValue: { canApprove: () => manager } },
        { provide: Treasury, useValue: { enter } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open } },
      ],
    });
    const fixture = TestBed.createComponent(EndOfDayPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const forms = () => fixture.debugElement.queryAll(By.directive(EodInvoiceForm)).map((d) => d.componentInstance as unknown as Record<string, any>);
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any>, forms };
  }

  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.day.mockReturnValue(of(null));
    api.days.mockReturnValue(of([]));
    api.photo.mockReturnValue(of(new Blob(['x'], { type: 'image/jpeg' })));
    open.mockReset();
    enter.mockReset();
    notify.info.mockReset();
    notify.error.mockReset();
    tabs = ['EndOfDay'];
    manager = false;
    URL.createObjectURL = vi.fn(() => 'blob:photo');
    URL.revokeObjectURL = vi.fn();
  });

  it('opens on the business day with its three sections, each invoice with its photo, and each section counted and added up', async () => {
    api.day.mockReturnValue(of(day({ invoices: threeInvoices })));
    const { el } = await render();

    expect(api.day).toHaveBeenCalledWith('2026-11-04');
    expect(api.days).toHaveBeenCalledWith('2026-10-22', '2026-11-04');
    expect([...el.querySelectorAll('section.step h3')].map(text)).toEqual([
      '2 Cash purchase & expense invoices تسجيل فواتير مشتريات ومصروفات نقدية',
      '3 Credit / on-account invoices تسجيل فواتير آجل',
      '4 Daily sales report / revenue تسجيل ريبورت المبيعات والإيراد',
    ]);
    expect([...el.querySelectorAll('article.invoice .what')].map(text)).toEqual([
      'Nile FarmsL.E 400.00', 'Delta DairyL.E 960.00Cheese', 'Delta DairyL.E 1,280.00',
    ]);
    expect(el.querySelectorAll('article.invoice app-photo-thumb img').length).toBe(3);
    expect([...el.querySelectorAll('.counter')].map(text)).toEqual([
      'Cash invoices count عدد الفواتير النقدية: 2Total cash invoices amount إجمالي مبلغ الفواتير النقدية: L.E 1,360.00',
      'Credit invoices count عدد الفواتير الآجل: 1Total credit amount إجمالي مبلغ الآجل: L.E 1,280.00',
    ]);
    // A new invoice of each kind can be added; the camera is offered as well as a file.
    expect(el.querySelectorAll('app-eod-invoice-form').length).toBe(2);
    expect(el.querySelector('input[aria-label="New cash invoice, take a photo"]')!.getAttribute('capture')).toBe('environment');
    expect(text(el.querySelector('.date-step .tag')!)).toBe('Draftمسودة');
  });

  it('adds an invoice with its photo, supplier and total, under the id made for it, then empties the form for the next', async () => {
    const { fixture, el, forms } = await render();
    expect(text(el.querySelector('.date-step .tag')!)).toBe('Not startedلم يبدأ');
    const [cash] = forms();

    await cash['save']();
    fixture.detectChanges();
    expect(api.addInvoice).not.toHaveBeenCalled();
    expect(text(el.querySelector('app-eod-invoice-form .error')!)).toBe('Photograph the invoice or attach its file. · صوّر الفاتورة أو أرفق ملفها.');

    const photo = new File(['jpeg'], 'nile.jpg', { type: 'image/jpeg' });
    cash['file'].set(photo);
    cash['supplierId'].set('nile');
    cash['total'] = 400.456;
    cash['touch']();
    const added = day({ invoices: [handedIn('c1', 'Cash', nile, 400.46)] });
    api.addInvoice.mockReturnValue(of(added));
    await cash['save']();
    fixture.detectChanges();

    const [date, id, entry, file] = api.addInvoice.mock.lastCall!;
    expect([date, typeof id, entry, file]).toEqual(['2026-11-04', 'string', { kind: 'Cash', supplierId: 'nile', reportedTotal: 400.46, note: null }, photo]);
    expect(text(el.querySelector('.counter')!)).toContain(': 1');
    expect([cash['file'](), cash['supplierId'](), cash['total']]).toEqual([null, null, null]);
    // The next is another invoice.
    cash['file'].set(photo);
    cash['supplierId'].set('delta');
    cash['total'] = 20;
    await cash['save']();
    expect(api.addInvoice.mock.lastCall![1]).not.toBe(id);
  });

  it('keeps the sales report as it is typed, adding the cash, Visa and tax up into the day’s revenue', async () => {
    api.saveSales.mockImplementation((_: string, s: Record<string, number>) => of(day({ ...s })));
    const { fixture, el, page } = await render();

    page['setSale']('cashAmount', 5_000);
    page['setSale']('cardAmount', '2500');
    page['setSale']('taxAmount', 1_050);
    page['setSale']('voidsAmount', 80);
    page['setSale']('notes', ' Two voids ');
    fixture.detectChanges();
    expect(text(el.querySelector('.revenue')!)).toBe('Total revenue · إجمالي الإيرادL.E 8,550.00cash + Visa + tax');
    expect(text(el.querySelector('.z-photo .muted.small')!)).toBe('Not saved yet · لم يُحفظ');

    await page['flushSales']();
    fixture.detectChanges();
    expect(api.saveSales).toHaveBeenCalledWith('2026-11-04', { cashAmount: 5_000, cardAmount: 2_500, taxAmount: 1_050, voidsAmount: 80, notes: 'Two voids' });
    expect(text(el.querySelector('.z-photo .muted.small')!)).toBe('Saved · تم الحفظ');

    page['setSale']('cashAmount', -1);
    expect(await page['flushSales']()).toBe(false);
    expect(page['salesProblem']()).toBe('The cash, Visa, tax and voids are zero or more. · المبالغ صفر أو أكثر.');
  });

  it('is reviewed before it is submitted: not without its sales or with an invoice left unadded, then locked once confirmed', async () => {
    api.day.mockReturnValue(of(day({ invoices: threeInvoices })));
    const { fixture, el, page } = await render();

    await page['review']();
    fixture.detectChanges();
    expect(open).not.toHaveBeenCalled();
    expect(text(el.querySelector('.submit-bar + .error')!)).toBe(
      "Enter the day's sales report: its cash or Visa takings. · أدخل ريبورت المبيعات: إيراد الكاش أو الفيزا.",
    );

    const withSales = day({ invoices: threeInvoices, cashAmount: 5_000, cardAmount: 2_500, taxAmount: 1_050, voidsAmount: 0 });
    api.saveSales.mockReturnValue(of(withSales));
    page['setSale']('cashAmount', 5_000);
    page['pendingIn']('Credit', true);
    await page['review']();
    expect(page['reviewProblem']()).toBe('An invoice is filled in under credit but not added: add it, or clear it. · توجد فاتورة لم تُضف بعد.');

    page['pendingIn']('Credit', false);
    open.mockReturnValue({ afterClosed: () => of(true) });
    api.submit.mockReturnValue(of({ ...withSales, status: 'Submitted', submittedBy: 'Hany', submittedAtUtc: '2026-11-04T21:00:00Z' }));
    await page['review']();
    fixture.detectChanges();
    // A field's disabled state is set by ngModel a moment later.
    await fixture.whenStable();
    fixture.detectChanges();

    expect(open.mock.lastCall![0]).toBe(EndOfDaySummaryDialog);
    expect(open.mock.lastCall![1].data.day).toEqual(withSales);
    expect(api.submit).toHaveBeenCalledWith('2026-11-04');
    expect(text(el.querySelector('.date-step .tag')!)).toBe('Submittedتم الإرسال');
    expect(el.querySelectorAll('app-eod-invoice-form').length).toBe(0);
    expect(el.querySelector('.submit-bar')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Cash"]')!.disabled).toBe(true);
    expect(el.querySelectorAll('article.invoice .row-actions').length).toBe(0);
  });

  it('offers a submitted day’s batch and takings to whoever works them, and reopening it to a manager', async () => {
    const submitted = day({ invoices: threeInvoices, status: 'Submitted', submittedBy: 'Hany', submittedAtUtc: '2026-11-04T21:00:00Z', cashAmount: 100 });
    api.day.mockReturnValue(of(submitted));
    // The branch: nothing but the day.
    let { el } = await render();
    expect([...el.querySelectorAll('.date-step a, .date-step button')].map(text)).toEqual([]);

    TestBed.resetTestingModule();
    tabs = ['EndOfDay', 'Purchases', 'Financials'];
    manager = true;
    ({ el } = await render());
    const batch = el.querySelector<HTMLAnchorElement>('.date-step a')!;
    expect(batch.getAttribute('href')).toBe('/costing/purchases/batch?date=2026-11-04');
    enter.mockResolvedValue(true);
    [...el.querySelectorAll<HTMLButtonElement>('.date-step button')].find((b) => text(b).includes('Takings in'))!.click();
    await Promise.resolve();
    expect(enter).toHaveBeenCalledWith('RevenueTransfer', { revenueDate: '2026-11-04' });

    api.reopen.mockReturnValue(of({ ...submitted, status: 'Draft', reopenedBy: 'Boss' }));
    [...el.querySelectorAll<HTMLButtonElement>('.date-step button')].find((b) => text(b).includes('Reopen'))!.click();
    await Promise.resolve();
    expect(api.reopen).toHaveBeenCalledWith('2026-11-04');
  });

  it('sums the day up before it is handed in: each kind of purchase, the sales, the cash left and what should reach the safe', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: MAT_DIALOG_DATA, useValue: { day: day({ invoices: threeInvoices, cashAmount: 5_000, cardAmount: 2_500, taxAmount: 1_050, voidsAmount: 80 }) } }],
    });
    const fixture = TestBed.createComponent(EndOfDaySummaryDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect([...el.querySelectorAll('.block')].map(text)).toEqual([
      'Cash purchases المشتريات النقديةL.E 1,360.002 invoices · فاتورة',
      'Credit purchases مشتريات آجلL.E 1,280.001 invoice · فاتورة',
      'Sales revenue إيراد المبيعاتL.E 8,550.00cash + Visa + tax',
    ]);
    const lines = [...el.querySelectorAll('.breakdown > div')].map(text);
    expect(lines).toContain('Expected net cash after cash invoices صافي الكاش بعد الفواتير النقديةL.E 3,640.00');
    expect(lines).toContain('Expected into the safe المتوقع توريده للخزنةtotal revenue less the cash invoicesL.E 7,190.00');
    expect([...el.querySelectorAll('button')].map(text)).toEqual(['Back · رجوع', 'task_alt Confirm & submit · تأكيد وإرسال التقفيل']);
  });
});
