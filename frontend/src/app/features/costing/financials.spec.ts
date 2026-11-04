import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { CostingApi, SafeVoucherInput } from '../../core/costing/costing.api';
import { EndOfDay, EndOfDayApi } from '../../core/costing/end-of-day.api';
import { MenuSalesApi } from '../../core/costing/menu-sales.api';
import { Employee } from '../../core/costing/staff';
import { NotifyService } from '../../core/ui/notify.service';
import { SafeVoucherDialog, SafeVoucherDialogData, TakingsDialog, TakingsDialogData, Treasury, taxIn } from './financials';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const employee = (id: string, name: string, isActive = true): Employee => ({ id, name, jobTitle: 'Chef', isActive });

describe('entering a safe entry', () => {
  const staff = vi.fn();
  const supplierBalances = vi.fn();
  const expenseItems = vi.fn();
  const takingsPreview = vi.fn();
  const taxPosition = vi.fn();
  const close = vi.fn();

  async function dialog(data: SafeVoucherDialogData) {
    TestBed.configureTestingModule({
      providers: [
        { provide: CostingApi, useValue: { supplierBalances, expenseItems, takingsPreview, taxPosition } },
        { provide: MenuSalesApi, useValue: { staff } },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    const fixture = TestBed.createComponent(SafeVoucherDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    supplierBalances.mockReset().mockReturnValue(of([
      { supplierId: 'nile', supplier: 'Nile Farms', isArchived: false, openingDebt: 0, creditPurchases: 2_500, payments: 500, balance: 2_000, lastPaidOn: null, openInvoices: 1 },
      { supplierId: 'delta', supplier: 'Delta Oils', isArchived: false, openingDebt: 0, creditPurchases: 100, payments: 100, balance: 0, lastPaidOn: null, openInvoices: 0 },
    ]));
    expenseItems.mockReset().mockReturnValue(of([]));
    taxPosition.mockReset().mockReturnValue(of({ collected: 560, paid: 400, owed: 160 }));
    staff.mockReset().mockReturnValue(of([employee('hassan', 'Hassan'), employee('old', 'Left Already', false)]));
    takingsPreview.mockReset().mockImplementation((day: string) => of({ date: day, entered: null, paidOut: 0, invoices: 0 }));
    close.mockReset();
  });

  it('pays a supplier what they are owed, never more, and only those owed are offered', async () => {
    const { page } = await dialog({ kind: 'SupplierPayment', canApprove: true, supplierId: 'nile' });

    expect(page['owedSuppliers']().map((s: { supplier: string }) => s.supplier)).toEqual(['Nile Farms']);
    // Owed in full to begin with.
    expect(page['amount']).toBe(2_000);
    page['amount'] = 2_500;
    expect(page['problem']()).toBe('That is more than they are owed.');

    page['amount'] = 750;
    page['notes'] = ' Cash on delivery ';
    page['done']();
    const voucher = close.mock.lastCall![0] as SafeVoucherInput;
    expect(voucher).toMatchObject({ kind: 'SupplierPayment', amount: 750, supplierId: 'nile', notes: 'Cash on delivery', expenseItemId: null, source: null });
    expect(voucher.requestId).not.toBe(voucher.transactionId);
  });

  it('advances an employee still employed, from the safe or a day’s takings', async () => {
    const { el, page } = await dialog({ kind: 'EmployeeAdvance', canApprove: true, today: '2026-10-20' });

    expect(text(el.querySelector('h2')!)).toBe('Employee advance سلفة موظف');
    expect(text(el)).toContain('It is not an expense: it comes off their pay for the month');
    expect(page['payable']().map((e: Employee) => e.name)).toEqual(['Hassan']);
    page['amount'] = 300;
    // No one named: a lump sum handed out as advances, shared among the staff.
    expect(page['problem']()).toBeNull();
    expect(text(el)).toContain('A lump sum handed out as advances, shared among the staff');
    page['done']();
    expect(close.mock.lastCall![0]).toMatchObject({ kind: 'EmployeeAdvance', amount: 300, employeeId: null });
    page['employeeId'].set('hassan');
    page['done']();
    expect(close.mock.lastCall![0]).toMatchObject({ kind: 'EmployeeAdvance', amount: 300, employeeId: 'hassan', revenueDate: null, date: '2026-10-20' });

    page['paidFrom'] = 'DayRevenue';
    page['revenueDate'] = '2026-10-21';
    expect(page['problem']()).toBe('Choose the day whose takings pay it: that day or one before the advance.');
    page['revenueDate'] = '2026-10-19';
    page['done']();
    expect(close.mock.lastCall![0]).toMatchObject({ employeeId: 'hassan', revenueDate: '2026-10-19', supplierId: null, expenseItemId: null });
  });

  it('pays a month’s salary to the employee it is for, left or not, once the month has started', async () => {
    const { page } = await dialog({ kind: 'SalaryPayment', canApprove: true, today: '2026-10-20', employeeId: 'old', amount: 5_526.33 });

    // The employee chosen on Staff; the month the entry's own until another is chosen.
    expect(page['payable']().map((e: Employee) => e.name)).toEqual(['Hassan', 'Left Already']);
    expect(page['payMonth']).toBe('2026-10');
    page['payMonth'] = '2026-11';
    expect(page['problem']()).toBe('A month’s salary is paid once the month has started.');
    page['payMonth'] = '';
    expect(page['problem']()).toBe('Choose the month whose pay this is.');
    page['payMonth'] = '2026-09';
    expect(page['problem']()).toBeNull();
    page['done']();
    expect(close.mock.lastCall![0]).toMatchObject({
      kind: 'SalaryPayment', amount: 5_526.33, employeeId: 'old', payrollMonth: '2026-09-01', revenueDate: null, date: '2026-10-20',
    });
  });

  // An expense voucher pays an operating expense, or the tax held in the safe over to the tax
  // authority (سداد/توريد ضرائب): no expense item then, and sent as a tax payment.
  it('pays the tax held in the safe over as a tax remittance, saying what is left owed', async () => {
    const { fixture, el, page } = await dialog({ kind: 'ExpenseVoucher', canApprove: true, today: '2026-10-12' });

    expect([...el.querySelectorAll('mat-button-toggle')].map(text)).toEqual(['Operating expense مصروف تشغيل', 'Tax remittance سداد/توريد ضرائب']);
    const type = (value: string) => {
      const amount = el.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!;
      amount.value = value;
      amount.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    type('100');
    expect(page['problem']()).toBe('Choose what the expense is.');

    page['taxPayment'].set(true);
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="Expense"]')).toBeNull();
    expect([...el.querySelectorAll('.breakdown dd')].map(text)).toEqual(['L.E 160.00', 'L.E 60.00']);
    expect(page['problem']()).toBeNull();

    // More than is held: said, and paid all the same (tax from before the treasury).
    type('200');
    expect(text(el.querySelector('.warn')!)).toContain('More than the tax the takings collected');
    expect(page['problem']()).toBeNull();

    type('100');
    page['notes'] = 'October VAT';
    page['done']();
    expect(close.mock.lastCall![0]).toMatchObject({ kind: 'TaxPayment', amount: 100, expenseItemId: null, notes: 'October VAT' });
  });

  it('opened as a tax payment, starts on the tax remittance', async () => {
    const { el, page } = await dialog({ kind: 'TaxPayment', canApprove: true, today: '2026-10-12' });

    expect(text(el.querySelector('h2')!)).toBe('Expense voucher إذن صرف مصروفات');
    expect(page['taxPayment']()).toBe(true);
    expect(text(el.querySelector('.breakdown dd')!)).toBe('L.E 160.00');
  });

  it('asks where the money came from, and tells an accountant that a manager approves it', async () => {
    const { el, page } = await dialog({ kind: 'Funding', canApprove: false });

    expect(page['sources']).toEqual(['OwnerFinancing', 'Other']);
    expect(text(el)).toContain('A manager approves safe entries: no cash moves until then.');
    expect([...el.querySelectorAll('button')].map(text)).toContain('Send for approval');
    expect(page['problem']()).toBe('Enter an amount more than nothing.');
  });

  it('is dated the till’s business day, not the browser’s', async () => {
    const { page } = await dialog({ kind: 'Funding', canApprove: true, today: '2026-10-12' });

    expect([page['date'], page['today']]).toEqual(['2026-10-12', '2026-10-12']);
  });

  it('works the tax out to the piastre, as the server does', () => {
    expect(taxIn(100, 14)).toEqual({ net: 87.72, tax: 12.28 });
    expect(taxIn(1_140, 14)).toEqual({ net: 1_000, tax: 140 });
  });
});

describe('a day’s takings from its Z report', () => {
  const takingsPreview = vi.fn();
  const close = vi.fn();
  const endOfDay = { day: vi.fn(), photo: vi.fn() };

  async function dialog(data: Partial<TakingsDialogData> = {}) {
    TestBed.configureTestingModule({
      providers: [
        { provide: CostingApi, useValue: { takingsPreview } },
        { provide: EndOfDayApi, useValue: endOfDay },
        { provide: MAT_DIALOG_DATA, useValue: { canApprove: true, today: '2026-10-14', ...data } satisfies TakingsDialogData },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    const fixture = TestBed.createComponent(TakingsDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const page = fixture.componentInstance as unknown as Record<string, any>;
    const fill = (figures: Partial<Record<'cash' | 'card' | 'tax' | 'voids', number | null>>, notes = '') => {
      Object.assign(page, figures, { notes });
      page['touch']();
      fixture.detectChanges();
    };
    return { fixture, el, page, fill };
  }

  beforeEach(() => {
    takingsPreview.mockReset().mockImplementation((day: string) => of({ date: day, entered: null, paidOut: 0, invoices: 0, supplierPayments: 0 }));
    close.mockReset();
    endOfDay.day.mockReset().mockReturnValue(of(null));
  });

  it('starts from the end of day handed in for the day, and goes back to it once something is typed over it', async () => {
    const closed = {
      id: 'day-13', date: '2026-10-13', status: 'Submitted', cashAmount: 5_000, cardAmount: 2_500, taxAmount: 1_050, voidsAmount: 80, notes: 'Two voids',
      salesPhoto: { fileName: 'z.jpg', contentType: 'image/jpeg', bytes: 10 }, submittedBy: 'Hany',
    } as EndOfDay;
    endOfDay.day.mockImplementation((day: string) => of(day === '2026-10-13' ? closed : { ...closed, status: 'Draft' }));
    takingsPreview.mockImplementation((day: string) => of({ date: day, entered: null, paidOut: 1_360, invoices: 2, supplierPayments: 0 }));
    const { fixture, el, page, fill } = await dialog({ revenueDate: '2026-10-13' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(endOfDay.day).toHaveBeenCalledWith('2026-10-13');
    expect([page['cash'], page['card'], page['tax'], page['voids'], page['notes']]).toEqual([5_000, 2_500, 1_050, 80, 'Two voids']);
    expect(text(el.querySelector('.from-day')!)).toBe(
      'assignment_turned_in From the end of day handed in by Hany: cash L.E 5,000.00, Visa L.E 2,500.00, tax L.E 1,050.00. من تقفيل اليومreceipt Z report · تقرير Z',
    );
    // All of it, less the cash invoices paid out of it.
    expect(text(el.querySelector('.breakdown .net dd')!)).toBe('L.E 7,190.00');

    fill({ cash: 4_000 });
    expect([...el.querySelectorAll('.from-day button')].map(text)).toEqual(['Use these · استخدام', 'receipt Z report · تقرير Z']);
    page['useHandedIn']();
    expect(page['cash']).toBe(5_000);

    // A day still a draft fills in nothing.
    page['revenueDate'] = '2026-10-12';
    page['dayChosen']();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.from-day')).toBeNull();
  });

  it('asks for the day, its cash, card, tax collected, voids and why, each in both languages', async () => {
    const { el } = await dialog();

    expect(text(el.querySelector('h2')!)).toBe('Takings in توريد إيراد اليومية');
    expect([...el.querySelectorAll('mat-label')].map(text)).toEqual([
      'Date · تاريخ اليومية',
      'Cash · إيراد الكاش',
      'Visa / Card · إيراد الفيزا',
      'Total tax collected · إجمالي الضريبة المحصلة',
      'Voids & refunds · قيمة الفويد والمرتجعات',
      'Void reasons / notes · أسباب الفويد وملاحظات اليومية',
    ]);
    expect(takingsPreview).toHaveBeenCalledWith('2026-10-14');
  });

  it('keeps the tax apart from the net sales, and puts all of it in the safe, cash, Visa and tax, less what was paid out of it', async () => {
    takingsPreview.mockImplementation((day: string) => of({ date: day, entered: null, paidOut: 1_454.07, invoices: 2, supplierPayments: 0 }));
    const { el, page, fill } = await dialog({ revenueDate: '2026-10-13' });

    fill({ cash: 10_495, card: 2_000, tax: 1_535, voids: 120 }, 'Two pizzas sent back');
    // Net sales 12,495 for the P&L; 1,535 of tax held; 12,575.93 into the safe after the 1,454.07 paid out.
    expect([...el.querySelectorAll('.breakdown dd')].map(text)).toEqual(['L.E 12,495.00', 'L.E 1,535.00', '(L.E 1,454.07)', 'L.E 12,575.93']);
    expect([...el.querySelectorAll('.breakdown dt')].map((dt) => text(dt).split(' ')[0])).toEqual(['Net', 'Tax', 'Paid', 'Total']);
    expect(text(el.querySelector('.breakdown .net')!)).toContain('cash + Visa + tax, less what was paid out of them');
    expect(page['problem']()).toBeNull();

    page['done']();
    expect(close.mock.lastCall![0]).toMatchObject({
      kind: 'RevenueTransfer', amount: 10_495, date: '2026-10-13', revenueDate: '2026-10-13', cardAmount: 2_000, taxAmount: 1_535, voidsAmount: 120,
      notes: 'Two pizzas sent back', includesTax: false,
    });
  });

  it('refuses a day with nothing taken, tax above the takings, a day to come, or a day entered already', async () => {
    const { page, fill } = await dialog();

    expect(page['problem']()).toBe("Enter the day's cash or card takings. · أدخل إيراد الكاش أو الفيزا.");
    fill({ cash: 0, card: 300, tax: 0 });
    expect(page['problem']()).toBeNull();
    fill({ cash: 100, card: 50, tax: 200 });
    expect(page['problem']()).toBe("The tax collected cannot be more than the day's sales. · الضريبة لا تزيد عن إجمالي المبيعات.");
    fill({ cash: 100, card: -5, tax: 0 });
    expect(page['problem']()).toBe('The cash, card, tax and voids are zero or more. · المبالغ صفر أو أكثر.');

    fill({ cash: 100, card: 0, tax: 0 });
    page['revenueDate'] = '2026-10-15';
    page['touch']();
    expect(page['problem']()).toBe('Those takings are of a day that has not come yet. · هذا اليوم لم يأتِ بعد.');

    takingsPreview.mockReturnValue(of({ date: '2026-10-12', entered: 10_495, paidOut: 0, invoices: 0, supplierPayments: 0 }));
    page['revenueDate'] = '2026-10-12';
    page['dayChosen']();
    await vi.waitFor(() => expect(page['problem']()).toContain('These takings are entered already: L.E 10,495.00.'));
    page['done']();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('sending a safe entry', () => {
  const recordVoucher = vi.fn();
  const approvalRequests = vi.fn();
  const open = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  const voucher: SafeVoucherInput = {
    requestId: 'q', transactionId: 't', kind: 'ExpenseVoucher', amount: 1_250, date: '2026-10-12', source: null, revenueDate: null,
    supplierId: null, expenseItemId: 'power', notes: null, reason: null, includesTax: false,
  };

  function service(manager: boolean): Treasury {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CostingApi,
          useValue: { recordVoucher, approvalRequests, businessToday: () => of({ today: '2026-10-12' }), financialSettings: () => of({ taxPercent: 14 }) },
        },
        { provide: MatDialog, useValue: { open } },
        { provide: NotifyService, useValue: notify },
        { provide: AuthService, useValue: { me: () => null, can: (p: string) => p !== Permissions.ApprovalDecide || manager } },
      ],
    });
    return TestBed.inject(Treasury);
  }

  beforeEach(() => {
    recordVoucher.mockReset();
    approvalRequests.mockReset().mockReturnValue(of({ pending: [], decided: [] }));
    open.mockReset().mockReturnValue({ afterClosed: () => of(voucher) });
    notify.info.mockReset();
  });

  it('is entered at once for a manager', async () => {
    recordVoucher.mockReturnValue(of({ id: 't', kind: 'ExpenseVoucher', amount: -1_250 }));

    expect(await service(true).enter('ExpenseVoucher')).toBe(true);

    // Dated the till's business day to begin with: after midnight, still the night before.
    expect(open.mock.lastCall![1].data).toEqual({ kind: 'ExpenseVoucher', canApprove: true, today: '2026-10-12' });
    expect(recordVoucher).toHaveBeenCalledWith(voucher);
    expect(notify.info).toHaveBeenCalledWith('Expense voucher entered: L.E 1,250.00.');
  });

  it('is a request for an accountant, said so', async () => {
    recordVoucher.mockReturnValue(of({ outcome: 'Requested', request: { action: 'Create', module: 'Treasury' } }));

    expect(await service(false).enter('ExpenseVoucher')).toBe(true);

    expect(notify.info).toHaveBeenCalledWith('Submitted to the manager for approval. Nothing is made until it is approved.');
  });

  it('asks for a day’s takings as its Z report gives them, and says the net sales, the tax held and all that went into the safe', async () => {
    const takings = { ...voucher, kind: 'RevenueTransfer' as const, amount: 760, revenueDate: '2026-10-11', cardAmount: 240, taxAmount: 140 };
    open.mockReturnValue({ afterClosed: () => of(takings) });
    recordVoucher.mockReturnValue(of({ id: 't', kind: 'RevenueTransfer', amount: 1_140, taxAmount: 140, cardAmount: 240, netAmount: 1_000 }));

    expect(await service(true).enter('RevenueTransfer', { revenueDate: '2026-10-11' })).toBe(true);

    expect(open.mock.lastCall![0]).toBe(TakingsDialog);
    expect(open.mock.lastCall![1].data).toEqual({ canApprove: true, today: '2026-10-12', revenueDate: '2026-10-11' });
    expect(recordVoucher).toHaveBeenCalledWith(takings);
    expect(notify.info).toHaveBeenCalledWith(
      'Takings of 2026-10-11 entered: net sales L.E 1,000.00, tax L.E 140.00 held for the tax authority, L.E 1,140.00 into the safe.',
    );
  });

  it('sends nothing when cancelled', async () => {
    open.mockReturnValue({ afterClosed: () => of(undefined) });

    expect(await service(true).enter('Funding')).toBe(false);
    expect(recordVoucher).not.toHaveBeenCalled();
  });
});
