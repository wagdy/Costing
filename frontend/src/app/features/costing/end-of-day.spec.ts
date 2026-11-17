import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CostingApi, Supplier } from '../../core/costing/costing.api';
import { CostingAccess, CostingTab } from '../../core/costing/costing-tabs';
import {
  EndOfDay,
  EndOfDayApi,
  EndOfDayInvoice,
  EndOfDayInvoiceKind,
  EndOfDayPayout,
  EndOfDayPayoutKind,
  EndOfDaySequence,
  EndOfDayUndoPreview,
} from '../../core/costing/end-of-day.api';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { EndOfDayPage, EndOfDaySummaryDialog, EndOfDayZeroSalesDialog, EodInvoiceForm } from './end-of-day-page';
import { EndOfDayUndo } from './end-of-day-undo';
import { EodPayoutForm } from './end-of-day-payouts';
import { HrStaffApi } from '../../core/costing/hr-staff.api';
import { Treasury } from './financials';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const nile = { id: 'nile', name: 'Nile Farms', contactPerson: 'Samy', phone: null } as Supplier;
const delta = { id: 'delta', name: 'Delta Dairy', contactPerson: null, phone: null } as Supplier;
const staff: Employee[] = [
  { id: 'mona', name: 'Mona', jobTitle: 'Cashier', isActive: true },
  { id: 'karim', name: 'Karim', jobTitle: null, isActive: false },
];

function paidOut(id: string, kind: EndOfDayPayoutKind, payee: string, amount: number, extra: Partial<EndOfDayPayout> = {}): EndOfDayPayout {
  return {
    id, kind, supplierId: kind === 'SupplierPayment' ? payee : null, employeeId: kind === 'EmployeeAdvance' ? payee : null,
    payee: kind === 'SupplierPayment' ? 'Nile Farms' : 'Mona', amount, note: null,
    receipt: { fileName: `${id}.jpg`, contentType: 'image/jpeg', bytes: 900 }, addedAtUtc: '2026-11-04T19:00:00Z', voucher: 'None', voucheredAtUtc: null,
    ...extra,
  };
}

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
  const payouts = over.payouts ?? [];
  const sum = (kind: EndOfDayInvoiceKind) => invoices.filter((i) => i.kind === kind).reduce((s, i) => s + i.reportedTotal, 0);
  const paid = (kind: EndOfDayPayoutKind) => payouts.filter((p) => p.kind === kind).reduce((s, p) => s + p.amount, 0);
  const [cash, card, tax, float] = [over.cashAmount ?? 0, over.cardAmount ?? 0, over.taxAmount ?? 0, over.openingFloat ?? 0];
  const cashTax = cash + card > 0 ? Math.round(((tax * cash) / (cash + card)) * 100) / 100 : 0;
  const out = sum('Cash') + paid('SupplierPayment') + paid('EmployeeAdvance');
  return {
    id: 'day-1', date: '2026-11-04', status: 'Draft', cashAmount: null, cardAmount: null, taxAmount: null, voidsAmount: null, notes: null, salesPhoto: null,
    cashInvoices: invoices.filter((i) => i.kind === 'Cash').length, cashInvoicesTotal: sum('Cash'),
    creditInvoices: invoices.filter((i) => i.kind === 'Credit').length, creditInvoicesTotal: sum('Credit'),
    netSales: cash + card, totalRevenue: cash + card + tax, cashAfterInvoices: cash - sum('Cash'), expectedIntoSafe: cash + card + tax - out,
    posted: invoices.filter((i) => i.purchaseInvoiceId).length, takingsEntered: null,
    createdBy: 'Hany', createdAtUtc: '2026-11-04T18:00:00Z', updatedBy: 'Hany', updatedAtUtc: '2026-11-04T18:00:00Z',
    submittedBy: null, submittedAtUtc: null, reopenedBy: null, reopenedAtUtc: null,
    openingFloat: null,
    supplierPayments: payouts.filter((p) => p.kind === 'SupplierPayment').length, supplierPaymentsTotal: paid('SupplierPayment'),
    advances: payouts.filter((p) => p.kind === 'EmployeeAdvance').length, advancesTotal: paid('EmployeeAdvance'),
    cashTax, cashSalesCollected: cash + cashTax, cashPaidOut: out, netCashInTill: float + cash + cashTax - out,
    ...over,
    invoices,
    payouts,
  };
}

// The days in their order, as the API gives them: none closed yet unless told.
function sequence(over: Partial<EndOfDaySequence> = {}): EndOfDaySequence {
  return { lastClosedDate: null, nextExpectedDate: null, today: '2026-11-04', allClosed: false, booksLockedUntil: null, warnings: [], lastClosed: null, ...over };
}

const lastClosed: EndOfDayUndoPreview = {
  date: '2026-11-04', submittedBy: 'Hany', submittedAtUtc: '2026-11-04T21:00:00Z', takings: 900, salesItems: 12, postedInvoices: 2, postedInvoicesTotal: 1_360,
  payouts: 0, payoutsTotal: 0, locked: false, zReports: 1,
};

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
    sequence: vi.fn(),
    voidLast: vi.fn(),
    photo: vi.fn(),
    addPayout: vi.fn(),
    changePayout: vi.fn(),
    replacePayoutReceipt: vi.fn(),
    removePayout: vi.fn(),
  };
  const open = vi.fn();
  const enter = vi.fn();
  const undo = vi.fn();
  const addLocal = vi.fn();
  let linked = false;
  const notify = { info: vi.fn(), error: vi.fn() };
  let tabs: CostingTab[] = ['EndOfDay'];
  let manager = false;

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EndOfDayApi, useValue: api },
        { provide: CostingApi, useValue: { suppliers: () => of([nile, delta]), businessToday: () => of({ today: '2026-11-04' }) } },
        { provide: MenuSalesApi, useValue: { staff: () => of(staff) } },
        { provide: HrStaffApi, useValue: { status: () => of({ linked, employeesSyncedAtUtc: null }), addLocal } },
        { provide: CostingAccess, useValue: { has: (tab: CostingTab) => tabs.includes(tab) } },
        { provide: Approvals, useValue: { canApprove: () => manager } },
        { provide: Treasury, useValue: { enter } },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open } },
        { provide: EndOfDayUndo, useValue: { undo } },
      ],
    });
    const fixture = TestBed.createComponent(EndOfDayPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const forms = () => fixture.debugElement.queryAll(By.directive(EodInvoiceForm)).map((d) => d.componentInstance as unknown as Record<string, any>);
    const payoutForms = () => fixture.debugElement.queryAll(By.directive(EodPayoutForm)).map((d) => d.componentInstance as unknown as Record<string, any>);
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any>, forms, payoutForms };
  }

  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.day.mockReturnValue(of(null));
    api.days.mockReturnValue(of([]));
    api.sequence.mockReturnValue(of(sequence()));
    undo.mockReset();
    api.photo.mockReturnValue(of(new Blob(['x'], { type: 'image/jpeg' })));
    open.mockReset();
    enter.mockReset();
    notify.info.mockReset();
    notify.error.mockReset();
    tabs = ['EndOfDay'];
    manager = false;
    linked = false;
    addLocal.mockReset();
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
      '4 Supplier cash payments إذن صرف مورد وإيصال السداد',
      '5 Employee cash advances سلفيات الموظفين وإيصال الصرف',
      '6 Daily sales report / revenue تسجيل ريبورت المبيعات والإيراد',
    ]);
    expect([...el.querySelectorAll('article.invoice .what')].map(text)).toEqual([
      'Nile FarmsL.E 400.00', 'Delta DairyL.E 960.00Cheese', 'Delta DairyL.E 1,280.00',
    ]);
    expect(el.querySelectorAll('article.invoice app-photo-thumb img').length).toBe(3);
    expect([...el.querySelectorAll('.counter')].map(text)).toEqual([
      'Cash invoices count عدد الفواتير النقدية: 2Total cash invoices amount إجمالي مبلغ الفواتير النقدية: L.E 1,360.00',
      'Credit invoices count عدد الفواتير الآجل: 1Total credit amount إجمالي مبلغ الآجل: L.E 1,280.00',
      'Supplier payments عدد أذونات الصرف: 0Total paid to suppliers إجمالي المدفوع للموردين: L.E 0.00',
      'Advances عدد السلفيات: 0Total advances إجمالي السلفيات: L.E 0.00',
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
    expect(api.saveSales).toHaveBeenCalledWith('2026-11-04', {
      cashAmount: 5_000, cardAmount: 2_500, taxAmount: 1_050, voidsAmount: 80, notes: 'Two voids', openingFloat: null, discountsAmount: null, discountReasons: [],
    });
    expect(text(el.querySelector('.z-photo .muted.small')!)).toBe('Saved · تم الحفظ');

    page['setSale']('cashAmount', -1);
    expect(await page['flushSales']()).toBe(false);
    expect(page['salesProblem']()).toBe('The float, cash, Visa, tax, voids and discounts are zero or more. · المبالغ صفر أو أكثر.');
  });

  it('keeps the discounts and why with the sales, never in the cash expected in the till', async () => {
    api.saveSales.mockImplementation((_: string, s: Record<string, unknown>) => of(day({ ...s })));
    const { fixture, el, page } = await render();
    page['setSale']('openingFloat', 500);
    page['setSale']('cashAmount', 3_000);
    fixture.detectChanges();
    const before = text(el.querySelector('.till-net')!);
    expect(el.querySelector('.discount-reasons')).toBeNull();

    // 400 of discounts: why, a reason at a time, one left blank and not sent.
    page['setSale']('discountsAmount', 400);
    page['addReason']();
    page['setReason'](0, { reason: ' Loyalty ', amount: 250 });
    page['addReason']();
    page['setReason'](1, { reason: 'Staff', amount: 150 });
    page['addReason']();
    fixture.detectChanges();
    expect(el.querySelectorAll('.discount-reasons .reason').length).toBe(3);
    expect(text(el.querySelector('.till-net')!)).toBe(before);
    expect(text(el.querySelector('.discount-note')!)).toContain('Discounts & promos of L.E 400.00 are not in it');

    expect(await page['flushSales']()).toBe(true);
    expect(api.saveSales.mock.lastCall![1]).toMatchObject({
      discountsAmount: 400, discountReasons: [{ reason: 'Loyalty', amount: 250, count: 1 }, { reason: 'Staff', amount: 150, count: 1 }],
    });

    // The reasons are never more than the discounts.
    page['setReason'](0, { amount: 300 });
    expect(await page['flushSales']()).toBe(false);
    expect(page['salesProblem']()).toBe('The reasons add up to more than the discounts. · مجموع الأسباب أكبر من الخصومات.');
  });

  it('is reviewed before it is submitted: without its sales only as a zero-sales day, not with an invoice left unadded, then locked once confirmed', async () => {
    api.day.mockReturnValue(of(day({ invoices: threeInvoices })));
    const { fixture, el, page } = await render();

    // No sales: asked whether it is a day that sold nothing; not meant, nothing handed in.
    open.mockReturnValue({ afterClosed: () => of(false) });
    await page['review']();
    fixture.detectChanges();
    expect(open.mock.lastCall![0]).toBe(EndOfDayZeroSalesDialog);
    expect(open.mock.lastCall![1].data).toEqual({ date: '2026-11-04' });
    expect(api.submit).not.toHaveBeenCalled();
    open.mockReset();

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
    expect(open.mock.lastCall![1].data.zeroSales).toBe(false);
    expect(api.submit).toHaveBeenCalledWith('2026-11-04', false);
    expect(api.sequence).toHaveBeenCalledTimes(2);
    expect(text(el.querySelector('.date-step .tag')!)).toBe('Submittedتم الإرسال');
    expect(el.querySelectorAll('app-eod-invoice-form').length).toBe(0);
    expect(el.querySelector('.submit-bar')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Cash"]')!.disabled).toBe(true);
    expect(el.querySelectorAll('article.invoice .row-actions').length).toBe(0);
  });

  it('offers a submitted day’s batch and takings to whoever works them, and undoing the last closed day to a manager', async () => {
    const submitted = day({ invoices: threeInvoices, status: 'Submitted', submittedBy: 'Hany', submittedAtUtc: '2026-11-04T21:00:00Z', cashAmount: 100 });
    api.day.mockReturnValue(of(submitted));
    // Every day closed up to today: the last one is shown, nothing more to hand in.
    api.sequence.mockReturnValue(of(sequence({ lastClosedDate: '2026-11-04', nextExpectedDate: '2026-11-05', allClosed: true, lastClosed })));
    // The branch: nothing but the day.
    let { el } = await render();
    expect(api.day).toHaveBeenCalledWith('2026-11-04');
    expect([...el.querySelectorAll('.date-step a, .date-step button')].map(text)).toEqual([]);
    expect(text(el.querySelector('.sequence-banner')!)).toBe('event_availableAll days are closed up to today. Come back tomorrow. (تم تقفيل جميع الأيام حتى تاريخ اليوم)');
    expect(el.querySelector<HTMLButtonElement>('.submit-bar button')!.disabled).toBe(true);
    expect(text(el.querySelector('.submit-bar + .error')!)).toBe('All days are closed up to today. Come back tomorrow. (تم تقفيل جميع الأيام حتى تاريخ اليوم)');

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

    const reopened = { ...submitted, status: 'Draft' as const, reopenedBy: 'Boss', reopenReason: 'Cash counted twice' };
    undo.mockResolvedValue({ day: reopened, takingsVoided: true, salesVoided: true, invoicesVoided: 2, payoutsVoided: 0, requestsRefused: 0 });
    api.sequence.mockReturnValue(of(sequence({ lastClosedDate: '2026-11-03', nextExpectedDate: '2026-11-04' })));
    [...el.querySelectorAll<HTMLButtonElement>('.date-step button')].find((b) => text(b).includes('Undo & reopen day'))!.click();
    await new Promise((r) => setTimeout(r));
    expect(undo).toHaveBeenCalledWith(lastClosed);
  });

  it('undoes the day shown only while it is the last closed day and outside the books locked', async () => {
    const submitted = day({ status: 'Submitted', submittedBy: 'Hany', submittedAtUtc: '2026-11-03T21:00:00Z', cashAmount: 100, date: '2026-11-03' });
    api.day.mockReturnValue(of(submitted));
    manager = true;
    api.sequence.mockReturnValue(of(sequence({ lastClosedDate: '2026-11-04', nextExpectedDate: '2026-11-05', allClosed: true, lastClosed })));
    const { fixture, el, page } = await render();
    await page['choose']('2026-11-03');
    fixture.detectChanges();
    expect([...el.querySelectorAll('.date-step button')].map(text).some((t) => t.includes('Undo'))).toBe(false);

    TestBed.resetTestingModule();
    api.sequence.mockReturnValue(of(sequence({ lastClosedDate: '2026-11-04', nextExpectedDate: '2026-11-05', allClosed: true, lastClosed: { ...lastClosed, locked: true } })));
    api.day.mockReturnValue(of({ ...submitted, date: '2026-11-04' }));
    const again = await render();
    expect([...again.el.querySelectorAll('.date-step button')].map(text).some((t) => t.includes('Undo'))).toBe(false);
  });

  it('locks the date to the next day in order and says so, with what to look at before closing it; a day out of order is not handed in', async () => {
    api.sequence.mockReturnValue(of(sequence({
      lastClosedDate: '2026-11-02', nextExpectedDate: '2026-11-03',
      warnings: ['There are draft invoices: 1 draft purchase invoice is dated on or before 3 Nov 2026 (Nile Farms). Consider posting them before closing the day.'],
    })));
    const { fixture, el, page } = await render();
    // A field's disabled state is set by ngModel a moment later.
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.day).toHaveBeenCalledWith('2026-11-03');
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Date"]')!.disabled).toBe(true);
    expect(text(el.querySelector('.sequence-banner')!)).toBe(
      'format_list_numbered The last closed day was Mon 2 Nov 2026. You are currently closing Tue 3 Nov 2026. You must close days in exact order. ' +
        '(آخر يوم تم إغلاقه هو 2/11/2026، يجب إغلاق يوم 3/11/2026 أولاً)',
    );
    expect([...el.querySelectorAll('.warnings li')].map(text)).toEqual([
      'There are draft invoices: 1 draft purchase invoice is dated on or before 3 Nov 2026 (Nile Farms). Consider posting them before closing the day.',
    ]);
    expect(el.querySelector<HTMLButtonElement>('.submit-bar button')!.disabled).toBe(false);

    // Today opened from Recent days: not handed in before the 3rd; the way back offered.
    await page['choose']('2026-11-04');
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('.submit-bar button')!.disabled).toBe(true);
    expect(text(el.querySelector('.submit-bar + .error')!)).toBe('Close 2026-11-03 first: days are closed in exact order. · يجب إغلاق يوم 2026-11-03 أولاً.');
    expect(el.querySelectorAll('.warnings li').length).toBe(0);
    await page['review']();
    expect(open).not.toHaveBeenCalled();
    const back = el.querySelector<HTMLButtonElement>('.sequence-banner button')!;
    expect(text(back)).toBe('Go to 3 Nov · الذهاب لليوم');
    back.click();
    await new Promise((r) => setTimeout(r));
    expect(api.day).toHaveBeenLastCalledWith('2026-11-03');
  });

  it('closes a day with nothing handed in as a zero-sales day once that is confirmed', async () => {
    api.sequence.mockReturnValue(of(sequence({ lastClosedDate: '2026-11-03', nextExpectedDate: '2026-11-04' })));
    const { page } = await render();
    open.mockReturnValue({ afterClosed: () => of(true) });
    api.submit.mockReturnValue(of(day({ status: 'Submitted', submittedBy: 'Hany', submittedAtUtc: '2026-11-04T21:00:00Z', warnings: [] })));
    await page['review']();

    // Asked once; nothing handed in, so no summary to review.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.lastCall![0]).toBe(EndOfDayZeroSalesDialog);
    expect(api.submit).toHaveBeenCalledWith('2026-11-04', true);
    expect(notify.info.mock.lastCall![0]).toBe('The end of day of 2026-11-04 is submitted with no sales. · تم إرسال التقفيل.');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: MAT_DIALOG_DATA, useValue: { date: '2026-11-04' } }] });
    const dialog = TestBed.createComponent(EndOfDayZeroSalesDialog);
    dialog.detectChanges();
    expect(text(dialog.nativeElement)).toContain(
      'No POS sales found for this date. Are you sure you want to close this as a Zero-Sales day to maintain the sequence?',
    );
  });

  it('hands in a supplier payment and an advance, each with its receipt, the advance only to someone still on the staff', async () => {
    const { fixture, el, payoutForms } = await render();
    expect(el.querySelectorAll('app-eod-payout-form').length).toBe(2);
    expect(el.querySelector('input[aria-label="New supplier payment, take a photo"]')!.getAttribute('capture')).toBe('environment');
    const [supplier, advance] = payoutForms();
    expect(advance['activeEmployees']().map((e: Employee) => e.name)).toEqual(['Mona']);

    // Not without its receipt.
    supplier['payeeId'].set('nile');
    supplier['amount'] = 300;
    await supplier['save']();
    fixture.detectChanges();
    expect(text(el.querySelector('app-eod-payout-form .error')!)).toBe('Photograph the payment receipt or attach its file. · صوّر إيصال السداد أو أرفق ملفه.');

    const receipt = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    supplier['file'].set(receipt);
    api.addPayout.mockReturnValue(of(day({ payouts: [paidOut('p1', 'SupplierPayment', 'nile', 300)] })));
    await supplier['save']();
    fixture.detectChanges();
    const [date, kind, id, entry, file] = api.addPayout.mock.lastCall!;
    expect([date, kind, typeof id, entry, file]).toEqual(['2026-11-04', 'SupplierPayment', 'string', { payeeId: 'nile', amount: 300, note: null }, receipt]);
    expect([...el.querySelectorAll('article.payout .what')].map(text)).toEqual(['Nile FarmsL.E 300.00']);
    expect([supplier['file'](), supplier['payeeId'](), supplier['amount']]).toEqual([null, null, null]);

    // An advance needs its employee.
    advance['file'].set(receipt);
    advance['amount'] = 150;
    await advance['save']();
    expect(advance['problem']()).toBe('Choose the employee from the list. · اختر الموظف من القائمة.');
  });

  it('adds someone new to the staff from the advance form while HR is not linked, and chooses them', async () => {
    const { fixture, el, page, payoutForms } = await render();
    const advance = payoutForms()[1];
    const addButton = [...el.querySelectorAll<HTMLButtonElement>('app-eod-payout-form button')].find((b) => text(b).includes('New staff member'));
    expect(addButton).toBeTruthy();

    addLocal.mockReturnValue(of({ id: 'samir', name: 'Samir', jobTitle: null, isActive: true }));
    advance['adding'].set(true);
    advance['newName'] = ' Samir ';
    await advance['addStaff']();
    fixture.detectChanges();
    expect(addLocal).toHaveBeenCalledWith(expect.any(String), 'Samir', null);
    expect(advance['payeeId']()).toBe('samir');
    expect(advance['adding']()).toBe(false);
    // On the page's staff from now, for every form.
    expect(page['employees']().map((e: Employee) => e.name)).toContain('Samir');
  });

  it('chooses the employee from HR’s while it is linked, and adds no one here', async () => {
    linked = true;
    const { el, payoutForms } = await render();
    expect(payoutForms()[1]['hrLinked']()).toBe(true);
    expect([...el.querySelectorAll('app-eod-payout-form button')].some((b) => text(b).includes('New staff member'))).toBe(false);
    expect(text(el.querySelectorAll('app-eod-payout-form')[1])).toContain('From HR · من الموارد البشرية');
  });

  it('works out the cash left in the till as the sales are typed: the float and the cash sales, less all paid out, the Visa never in it', async () => {
    api.day.mockReturnValue(of(day({
      invoices: threeInvoices,
      payouts: [paidOut('p1', 'SupplierPayment', 'nile', 300), paidOut('a1', 'EmployeeAdvance', 'mona', 200)],
    })));
    const { fixture, el, page } = await render();

    page['setSale']('openingFloat', 500);
    page['setSale']('cashAmount', 5_000);
    page['setSale']('cardAmount', 2_500);
    page['setSale']('taxAmount', 1_050);
    fixture.detectChanges();
    // 500 + 5,000 and its 700 of tax, less 1,360 of cash invoices, 300 to a supplier and 200 advanced.
    expect(text(el.querySelector('.till-net')!)).toBe('L.E 4,340.00');
    expect([...el.querySelectorAll('.till-sum > div')].map(text)).toEqual([
      'Opening float العهدةL.E 500.00',
      'Cash sales مبيعات الكاشwith their tax, L.E 700.00+ L.E 5,700.00',
      'Cash invoices الفواتير النقدية− L.E 1,360.00',
      'Supplier payments مدفوعات الموردين− L.E 300.00',
      'Employee advances السلفيات− L.E 200.00',
    ]);
    expect(el.querySelector('.till')!.classList).not.toContain('short');

    // More paid out than the drawer took in: said.
    page['setSale']('cashAmount', 1_000);
    page['setSale']('taxAmount', 0);
    page['setSale']('openingFloat', 0);
    fixture.detectChanges();
    expect(text(el.querySelector('.till-net')!)).toBe('L.E -860.00');
    expect(el.querySelector('.till')!.classList).toContain('short');
    expect(text(el.querySelector('.till .error')!)).toBe('More was paid out than the drawer took in: check the amounts. · المصروف أكبر من الكاش.');
  });

  it('shows where each payment is once handed in, and lets one a manager refused be taken off', async () => {
    const reopened = day({
      reopenedBy: 'Boss',
      payouts: [
        paidOut('p1', 'SupplierPayment', 'nile', 300, { voucher: 'InSafe', voucheredAtUtc: '2026-11-04T21:00:00Z' }),
        paidOut('a1', 'EmployeeAdvance', 'mona', 200, { voucher: 'Refused', voucheredAtUtc: '2026-11-04T21:00:00Z' }),
        paidOut('a2', 'EmployeeAdvance', 'mona', 50),
      ],
    });
    api.day.mockReturnValue(of(reopened));
    const { el } = await render();

    const rows = [...el.querySelectorAll('article.payout')];
    expect(rows.map((r) => text(r.querySelector('.what')!))).toEqual([
      'Nile FarmsL.E 300.00In the safeمسجل في الخزنة',
      'MonaL.E 200.00Refused by a managerرفضه المدير',
      'MonaL.E 50.00',
    ]);
    // In the safe: corrected there. Refused: taken off only. Not handed in yet: changed or taken off.
    expect(rows.map((r) => [...r.querySelectorAll('.row-actions button')].map((b) => b.getAttribute('title')))).toEqual([
      [], ['Take off · حذف'], ['Change · تعديل', 'Take off · حذف'],
    ]);

    api.removePayout.mockReturnValue(of(day({ ...reopened, payouts: [reopened.payouts[0], reopened.payouts[2]] })));
    rows[1].querySelector<HTMLButtonElement>('.row-actions button')!.click();
    await Promise.resolve();
    expect(api.removePayout).toHaveBeenCalledWith('2026-11-04', 'EmployeeAdvance', 'a1');
  });

  it('is not reviewed with a payment filled in and left unadded', async () => {
    api.day.mockReturnValue(of(day({ cashAmount: 100 })));
    const { page } = await render();
    page['pendingIn']('SupplierPayment', true);
    await page['review']();
    expect(page['reviewProblem']()).toBe('A supplier payment is filled in but not added: add it, or clear it. · يوجد مبلغ لم يُضف بعد.');
    expect(open).not.toHaveBeenCalled();
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
      'Paid to suppliers مدفوعات الموردينL.E 0.000 payments · إذن صرف',
      'Employee advances سلفيات الموظفينL.E 0.000 advances · سلفة',
      'Sales revenue إيراد المبيعاتL.E 8,550.00cash + Visa + tax',
    ]);
    const lines = [...el.querySelectorAll('.breakdown > div')].map(text);
    expect(lines).toContain('Expected net cash after cash invoices صافي الكاش بعد الفواتير النقديةL.E 3,640.00');
    expect(lines).toContain('Expected into the safe المتوقع توريده للخزنةtotal revenue less all paid out of itL.E 7,190.00');
    // The drawer: no float, the cash 5,000 with its 700 of tax, less the cash invoices.
    expect([...el.querySelectorAll('.till > div')].map(text)).toEqual([
      'Opening float العهدة / الفكةL.E 0.00',
      'Cash sales with their tax مبيعات الكاش بالضريبةL.E 5,700.00',
      'Paid out of the till المصروف من الكاش(L.E 1,360.00)',
      'Net cash expected in till الصافي الفعلي المتبقي في الكاشcount the drawer against this: the Visa is not in itL.E 4,340.00',
    ]);
    expect([...el.querySelectorAll('button')].map(text)).toEqual(['Back · رجوع', 'task_alt Confirm & submit · تأكيد وإرسال التقفيل']);
  });
});
