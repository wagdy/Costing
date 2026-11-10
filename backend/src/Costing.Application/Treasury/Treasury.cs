using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Domain.Staff;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Expenses;
using Costing.Domain.Purchases;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;

namespace Costing.Application.Treasury;

// The treasury (الماليات): the safe's ledger and what is owed to suppliers. Money goes into the
// safe as its opening balance, as funding, or as a day's takings; it goes out as expense
// vouchers, tax paid over, supplier payments, invoices paid in cash, employees' advances and
// salaries, from the safe or straight from a day's takings. An invoice on credit is owed to its
// supplier until a payment voucher pays it. An advance is owed by the employee until the payroll
// of its own month deducts it.
//
// A day's takings are entered once, from the day's Z report: its cash and card sales before tax,
// the tax collected on them, and its voids. The safe is the one treasury: all of it, cash, card
// and tax, goes in. What was paid straight out of them by then came out of the drawer, so the safe
// gets the rest; what is paid out of them, or put back by a void, once they are in, moves the
// safe. The net sales (cash and card) are the revenue; the tax is held for the tax authority until
// a tax payment (سداد ضرائب) pays it over, never revenue and never an expense.
//
// Every safe entry is a manager's: anyone else's is a request (ApprovalRequests.cs), and no cash
// moves until it is approved. A supplier's opening debt moves no cash, and is entered at once.

// A safe entry as entered: held by a request until a manager approves it. TransactionId is made
// by the till. A day's takings' Amount is their cash; CardAmount their card takings, TaxAmount
// the tax collected in both, VoidsAmount the day's voids and refunds. IncludesTax instead of
// TaxAmount: the cash includes tax at the till's rate (TaxPercent, set by the server when it is
// entered, never the screen's, and kept with a request so the approval takes the same tax off).
public sealed record SafeVoucher(
    Guid TransactionId,
    SafeTransactionKind Kind,
    decimal Amount,
    DateOnly Date,
    FundingSource? Source = null,
    DateOnly? RevenueDate = null,
    Guid? SupplierId = null,
    Guid? ExpenseItemId = null,
    Guid? PurchaseInvoiceId = null,
    string? Notes = null,
    bool IncludesTax = false,
    decimal? TaxPercent = null,
    // An advance's or a salary's employee; a salary's month (its first day).
    Guid? EmployeeId = null,
    DateOnly? PayrollMonth = null,
    decimal? CardAmount = null,
    decimal? TaxAmount = null,
    decimal? VoidsAmount = null,
    // A payroll payment's: the payroll run from HR it pays.
    Guid? PayrollRunId = null);

// The tax rate the bills are charged, as set on Tax & service.
public interface ITaxRate
{
    Task<decimal> PercentAsync(CancellationToken cancellationToken);
}

public sealed record SafeTransactionDto(
    Guid Id,
    SafeTransactionKind Kind,
    CashFund Fund,
    decimal Amount,
    DateOnly BusinessDate,
    DateOnly? RevenueDate,
    FundingSource? Source,
    Guid? SupplierId,
    Guid? PurchaseInvoiceId,
    Guid? ExpenseItemId,
    string? Notes,
    string RecordedBy,
    DateTime RecordedAtUtc,
    string? ApprovedBy,
    Guid? ReversalOf,
    DateTime? VoidedAtUtc,
    string? VoidedBy,
    bool IncludesTax,
    decimal? TaxPercent,
    decimal TaxAmount,
    decimal? GrossAmount,
    Guid? EmployeeId,
    DateOnly? PayrollMonth,
    decimal CardAmount = 0,
    decimal VoidsAmount = 0,
    decimal NetAmount = 0)
{
    public static SafeTransactionDto From(SafeTransaction t) => new(
        t.Id, t.Kind, t.Fund, t.Amount, t.BusinessDate, t.RevenueDate, t.Source, t.SupplierId, t.PurchaseInvoiceId, t.ExpenseItemId, t.Notes,
        t.RecordedBy, t.RecordedAtUtc, t.ApprovedBy, t.ReversalOf, t.VoidedAtUtc, t.VoidedBy, t.IncludesTax, t.TaxPercent, t.TaxAmount,
        t.GrossAmount, t.EmployeeId, t.PayrollMonth, t.CardAmount, t.VoidsAmount, t.Kind == SafeTransactionKind.RevenueTransfer ? t.NetAmount : 0);
}

// Checks, describes and enters safe entries: for a manager's own and for an approval alike. What
// it enters is added to the safe's and the suppliers' ledgers, for the caller to save.
internal sealed class TreasuryWriter(
    ISafeTransactionRepository safe,
    ISupplierLedgerRepository suppliersLedger,
    ISupplierRepository suppliers,
    IExpenseItemRepository expenses,
    IPurchaseInvoiceRepository invoices,
    IRecordDescriptions descriptions,
    ITaxRate taxRate,
    IStaffMemberRepository employees,
    IPayrollRunRepository payrollRuns,
    Costing.Application.Integrations.HrOutbox hr)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // Invoices posted in this unit of work, not saved yet: read from here, not the database.
    private readonly Dictionary<Guid, PurchaseInvoice> _posting = [];

    // The business day: the one cash belongs to, as the day report counts it. Between midnight
    // and the hour the business day starts, the restaurant's calendar is a day ahead of it; an
    // entry dated that calendar day is taken as well (Latest), never one later.
    public DateOnly Today => descriptions.BusinessDateOf(DateTime.UtcNow);

    private DateOnly Latest
    {
        get
        {
            var now = DateTime.UtcNow;
            var (business, calendar) = (descriptions.BusinessDateOf(now), descriptions.LocalDateOf(now));
            return calendar > business ? calendar : business;
        }
    }

    // A voucher as the screens sent it, with the till's tax rate when its takings include tax. Any
    // rate the screen sent is replaced: the rate is the till's, not the caller's.
    public async Task<SafeVoucher> WithTaxRateAsync(SafeVoucher voucher, CancellationToken cancellationToken)
    {
        // The tax collected as the Z report gives it: nothing to work out.
        if (voucher.TaxAmount is not null)
            return voucher with { IncludesTax = false, TaxPercent = null };
        if (!voucher.IncludesTax)
            return voucher with { TaxPercent = null };
        if (voucher.Kind != SafeTransactionKind.RevenueTransfer)
            throw new DomainException("Only a day's takings are entered with the tax in them.");
        return voucher with { TaxPercent = await taxRate.PercentAsync(cancellationToken) };
    }

    // What would stop it being entered now, refused before a request goes to a manager. Checked
    // again on approval, as balances may have moved.
    public async Task CheckAsync(SafeVoucher voucher, CancellationToken cancellationToken)
    {
        if (voucher.IncludesTax && (voucher.Kind != SafeTransactionKind.RevenueTransfer || voucher.TaxPercent is null))
            throw new DomainException("Only a day's takings are entered with the tax in them, at the till's rate.");
        if (voucher.Date > Latest)
            throw new DomainException("A safe entry is dated today or before: cash cannot move in the future.");
        if (voucher.RevenueDate > Latest)
            throw new DomainException("Those takings are of a day that has not come yet.");
        if (voucher.RevenueDate > voucher.Date)
            throw new DomainException("A day's takings are used on that day or after it.");
        if (voucher.Notes?.Trim().Length > SafeTransaction.MaxNotesLength)
            throw new DomainException($"Keep the notes under {SafeTransaction.MaxNotesLength} characters. · الملاحظات {SafeTransaction.MaxNotesLength} حرف على الأكثر.");
        if (voucher.Kind != SafeTransactionKind.RevenueTransfer && (voucher.CardAmount is not null || voucher.TaxAmount is not null || voucher.VoidsAmount is not null))
            throw new DomainException("Only a day's takings have card takings, tax and voids.");
        switch (voucher.Kind)
        {
            case SafeTransactionKind.OpeningBalance:
                if (await safe.AnyOpeningBalanceAsync(cancellationToken))
                    throw new DomainException("The safe already has its opening balance. Money put in since is funding.");
                if (voucher.Source is not (FundingSource.CarriedOver or FundingSource.OwnerFinancing))
                    throw new DomainException("Say where the opening balance came from: carried over, or the owners' financing.");
                break;
            case SafeTransactionKind.Funding:
                if (voucher.Source is not (FundingSource.OwnerFinancing or FundingSource.Other))
                    throw new DomainException("Say where the money came from: the owners' financing, or another source.");
                break;
            case SafeTransactionKind.RevenueTransfer:
                if (voucher.RevenueDate is not { } day)
                    throw new DomainException("Choose the day whose takings go into the safe.");
                // One Z report a day.
                if (await safe.GetTakingsAsync(day, cancellationToken) is { } entered)
                    throw new DomainException(
                        $"The takings of {Day(day)} are entered already: {Money(entered.TakingsTotal)}. To change them, void that entry and enter them again. · " +
                        "إيراد هذا اليوم مسجل بالفعل: ألغه من الخزنة ثم أدخله من جديد.");
                if (voucher.VoidsAmount < 0)
                    throw new DomainException("The cash, card, tax and voids are zero or more. · المبالغ صفر أو أكثر.");
                Takings(voucher);
                // Checked: zero cash with card takings is a day's takings all the same.
                return;
            case SafeTransactionKind.TaxPayment:
                if (voucher.ExpenseItemId is not null || voucher.SupplierId is not null || voucher.EmployeeId is not null)
                    throw new DomainException("A tax payment pays the tax authority, nothing else.");
                break;
            case SafeTransactionKind.ExpenseVoucher:
                await ExpenseItemAsync(voucher.ExpenseItemId, cancellationToken);
                break;
            case SafeTransactionKind.SupplierPayment:
            {
                var supplier = await SupplierAsync(voucher.SupplierId, cancellationToken);
                var owed = await suppliersLedger.BalanceAsync(supplier.Id, cancellationToken);
                if (voucher.Amount > owed)
                    throw new DomainException(owed > 0
                        ? $"{supplier.Name} is owed {Money(owed)}: pay that much or less."
                        : $"Nothing is owed to {supplier.Name}.");
                break;
            }
            case SafeTransactionKind.InvoicePayment:
                await UnpaidInvoiceAsync(voucher.PurchaseInvoiceId, cancellationToken);
                break;
            case SafeTransactionKind.EmployeeAdvance:
            {
                // No one named: advances handed out as a lump sum, for the staff to share.
                if (voucher.EmployeeId is null)
                    break;
                var employee = await EmployeeAsync(voucher.EmployeeId, cancellationToken);
                if (!employee.IsActive)
                    throw new DomainException($"{employee.Name} has left: bring them back on Staff first.");
                break;
            }
            case SafeTransactionKind.SalaryPayment:
            {
                await SalaryAsync(voucher, cancellationToken);
                break;
            }
            case SafeTransactionKind.PayrollPayment:
            {
                var run = await PayrollRunAsync(voucher.PayrollRunId, cancellationToken);
                if (voucher.Amount != run.NetCashPayable || voucher.PayrollMonth != run.Period)
                    throw new DomainException($"The payroll of {run.PeriodName} is paid as HR sent it: {Money(run.NetCashPayable)}.");
                break;
            }
            default:
                throw new DomainException("Say what the safe entry is.");
        }

        if (voucher.Kind != SafeTransactionKind.OpeningBalance && voucher.Amount <= 0)
            throw new DomainException("Enter an amount more than nothing.");
        if (voucher.Amount < 0)
            throw new DomainException("Enter an amount of zero or more.");
    }

    // Enters it: the safe's ledger line, and for a supplier payment its line on the supplier's
    // account. recordedBy is who entered it; approvedBy, the manager who approved it.
    public async Task<SafeTransaction> ApplyAsync(SafeVoucher voucher, string recordedBy, string? approvedBy, CancellationToken cancellationToken)
    {
        await CheckAsync(voucher, cancellationToken);
        var id = voucher.TransactionId;
        SafeTransaction entry;
        switch (voucher.Kind)
        {
            case SafeTransactionKind.OpeningBalance:
                entry = SafeTransaction.OpeningBalance(id, voucher.Amount, voucher.Date, voucher.Source!.Value, voucher.Notes, recordedBy, approvedBy);
                break;
            case SafeTransactionKind.Funding:
                entry = SafeTransaction.Funding(id, voucher.Amount, voucher.Date, voucher.Source!.Value, voucher.Notes, recordedBy, approvedBy);
                break;
            case SafeTransactionKind.RevenueTransfer:
                entry = SafeTransaction.RevenueTransfer(
                    id, voucher.Amount, voucher.Date, voucher.RevenueDate!.Value, voucher.Notes, recordedBy, approvedBy,
                    voucher.IncludesTax ? voucher.TaxPercent : null, await safe.PaidOutOfTakingsAsync(voucher.RevenueDate.Value, cancellationToken),
                    voucher.CardAmount ?? 0, voucher.TaxAmount, voucher.VoidsAmount ?? 0);
                break;
            case SafeTransactionKind.ExpenseVoucher:
                entry = SafeTransaction.ExpenseVoucher(id, voucher.Amount, voucher.Date, voucher.ExpenseItemId!.Value, voucher.Notes, recordedBy, approvedBy);
                break;
            case SafeTransactionKind.TaxPayment:
                entry = SafeTransaction.TaxPayment(id, voucher.Amount, voucher.Date, voucher.Notes, recordedBy, approvedBy);
                break;
            case SafeTransactionKind.SupplierPayment:
                entry = SafeTransaction.SupplierPayment(
                    id, voucher.Amount, voucher.Date, voucher.SupplierId!.Value, voucher.Notes, recordedBy, approvedBy, voucher.RevenueDate,
                    await TakingsInSafeAsync(voucher.RevenueDate, cancellationToken));
                suppliersLedger.Add(SupplierLedgerEntry.Payment(entry));
                break;
            case SafeTransactionKind.InvoicePayment:
            {
                var invoice = await UnpaidInvoiceAsync(voucher.PurchaseInvoiceId, cancellationToken);
                entry = SafeTransaction.InvoicePayment(
                    id, invoice.Total, voucher.Date, invoice.Id, invoice.SupplierId, invoice.RevenueDate, recordedBy, approvedBy,
                    await TakingsInSafeAsync(invoice.RevenueDate, cancellationToken));
                break;
            }
            case SafeTransactionKind.EmployeeAdvance:
                entry = voucher.EmployeeId is not { } advancedTo
                    ? SafeTransaction.PendingAdvance(
                        id, voucher.Amount, voucher.Date, voucher.Notes, recordedBy, approvedBy, voucher.RevenueDate,
                        await TakingsInSafeAsync(voucher.RevenueDate, cancellationToken))
                    : SafeTransaction.EmployeeAdvance(
                        id, voucher.Amount, voucher.Date, advancedTo, PayMonthOf(voucher.Date),
                        voucher.Notes, recordedBy, approvedBy, voucher.RevenueDate, await TakingsInSafeAsync(voucher.RevenueDate, cancellationToken));
                // An employee from HR: sent to HR, to come off their pay there.
                await hr.AdvanceAsync(entry, voided: false, cancellationToken);
                break;
            case SafeTransactionKind.SalaryPayment:
                entry = SafeTransaction.SalaryPayment(
                    id, voucher.Amount, voucher.Date, voucher.EmployeeId!.Value, voucher.PayrollMonth!.Value, voucher.Notes, recordedBy, approvedBy,
                    voucher.RevenueDate, await TakingsInSafeAsync(voucher.RevenueDate, cancellationToken));
                break;
            case SafeTransactionKind.PayrollPayment:
            {
                // Paid: the run is paid, and HR told so.
                var run = await PayrollRunAsync(voucher.PayrollRunId, cancellationToken);
                entry = SafeTransaction.PayrollPayment(id, voucher.Amount, voucher.Date, run.Id, run.Period, voucher.Notes, recordedBy, approvedBy);
                run.Disbursed(entry.Id, approvedBy ?? recordedBy);
                await hr.PayrollAsync(run, entry, voided: false, cancellationToken);
                break;
            }
            default:
                throw new DomainException("Say what the safe entry is.");
        }

        safe.Add(entry);
        return entry;
    }

    // Voids it, today: the opposite amount in the safe's ledger, and on the supplier's account too
    // for a supplier payment. A payment out of a day's takings goes back into the safe when they
    // are in it.
    public async Task VoidAsync(SafeTransaction entry, string by, CancellationToken cancellationToken)
    {
        safe.Add(entry.Void(Guid.NewGuid(), Today, by, await TakingsInSafeAsync(entry.RevenueDate, cancellationToken)));
        // An advance to an employee from HR: taken off their pay there too.
        if (entry.Kind == SafeTransactionKind.EmployeeAdvance)
            await hr.AdvanceAsync(entry, voided: true, cancellationToken);
        // A payroll payment: the run is owed again, and HR told so.
        if (entry.Kind == SafeTransactionKind.PayrollPayment && entry.PayrollRunId is { } runId && await payrollRuns.GetByIdAsync(runId, cancellationToken) is { } run)
        {
            run.Undisbursed();
            await hr.PayrollAsync(run, entry, voided: true, cancellationToken);
        }
        if (entry.Kind == SafeTransactionKind.SupplierPayment)
            foreach (var line in (await suppliersLedger.GetBySourceAsync(entry.Id, cancellationToken)).Where(l => !l.IsReversal))
                suppliersLedger.Add(line.Reverse(Today, by));
    }

    // A posted invoice's payment, as it was chosen: on credit, owed to the supplier at once (no
    // cash moves); in cash, entered for a manager and asked of one for anyone else. Returns the
    // request when it was asked.
    public async Task<ApprovalRequest?> SettleAsync(
        PurchaseInvoice invoice, Guid requestId, string staffId, string staffName, bool canApprove, IApprovalRequestRepository requests,
        CancellationToken cancellationToken)
    {
        // Nothing to pay; or a correction of an invoice from before the treasury, which touches
        // neither the safe nor a supplier's account.
        if (invoice.Total <= 0 || invoice.PaymentMethod == PurchasePaymentMethod.BeforeTreasury)
            return null;
        _posting[invoice.Id] = invoice;
        if (invoice.PaymentMethod == PurchasePaymentMethod.Credit)
        {
            suppliersLedger.Add(SupplierLedgerEntry.CreditInvoice(
                invoice.SupplierId!.Value, invoice.Id, invoice.Total, invoice.InvoiceDate ?? Today, staffName));
            return null;
        }

        // Paid today, or on the day of the takings it comes from when that is the calendar day
        // after midnight.
        var paidOn = invoice.RevenueDate > Today ? invoice.RevenueDate.Value : Today;
        var voucher = new SafeVoucher(
            Guid.NewGuid(), SafeTransactionKind.InvoicePayment, invoice.Total, paidOn, RevenueDate: invoice.RevenueDate, PurchaseInvoiceId: invoice.Id);
        if (canApprove)
        {
            await ApplyAsync(voucher, staffName, null, cancellationToken);
            return null;
        }

        await CheckAsync(voucher, cancellationToken);
        var (summary, changes) = await DescribeAsync(voucher, cancellationToken);
        var asked = ApprovalRequest.AskToChange(
            requestId, ApprovalModule.Treasury, ApprovalAction.Create, invoice.Id, summary, changes, ApprovalPayload.Write(voucher), null, staffId,
            staffName);
        requests.Add(asked);
        return asked;
    }

    // An invoice's cash payment and credit lines undone, for a voided invoice.
    public async Task UndoInvoiceAsync(PurchaseInvoice invoice, string by, CancellationToken cancellationToken)
    {
        if (await safe.GetPaymentOfInvoiceAsync(invoice.Id, cancellationToken) is { } payment)
            await VoidAsync(payment, by, cancellationToken);
        foreach (var line in (await suppliersLedger.GetBySourceAsync(invoice.Id, cancellationToken)).Where(l => !l.IsReversal))
            suppliersLedger.Add(line.Reverse(Today, by));
    }

    // "Supplier payment · Nile Farms · L.E 500.00 · 12 Oct 2026", for a request or a void; and what
    // it changes, line by line.
    public async Task<(string Summary, IReadOnlyList<ApprovalChange> Changes)> DescribeAsync(SafeVoucher voucher, CancellationToken cancellationToken)
    {
        var changes = new List<ApprovalChange> { new("Date", null, Day(voucher.Date)) };
        var amount = Money(voucher.Amount);
        string summary;
        switch (voucher.Kind)
        {
            case SafeTransactionKind.OpeningBalance:
            case SafeTransactionKind.Funding:
                var from = SourceName(voucher.Source);
                summary = $"{(voucher.Kind == SafeTransactionKind.OpeningBalance ? "Opening balance" : "Funding")} · {from} · {amount}";
                changes.Add(new ApprovalChange("Source", null, from));
                break;
            case SafeTransactionKind.RevenueTransfer:
            {
                var paidOut = await safe.PaidOutOfTakingsAsync(voucher.RevenueDate!.Value, cancellationToken);
                var (cash, card, tax) = Takings(voucher);
                summary = $"Takings of {Day(voucher.RevenueDate.Value)} · {Money(cash)} cash" + (card != 0 ? $", {Money(card)} card" : "") +
                    $" · net sales {Money(cash + card)}, {Money(cash + card + tax - paidOut)} into the safe";
                changes.Add(new ApprovalChange("Card · الفيزا", null, Money(card)));
                changes.Add(new ApprovalChange("Tax collected · الضريبة المحصلة", null, Money(tax)));
                changes.Add(new ApprovalChange("Net sales · صافي المبيعات", null, Money(cash + card)));
                if (voucher.VoidsAmount is > 0 and var voids)
                    changes.Add(new ApprovalChange("Voids and refunds · الفويد والمرتجعات", null, Money(voids)));
                changes.Add(new ApprovalChange("Paid out of them", null, Money(paidOut)));
                changes.Add(new ApprovalChange("Into the safe · إجمالي الوارد للخزنة", null, Money(cash + card + tax - paidOut)));
                break;
            }
            case SafeTransactionKind.ExpenseVoucher:
                var item = await ExpenseItemAsync(voucher.ExpenseItemId, cancellationToken);
                summary = $"Expense voucher · {item.Name} · {amount}";
                changes.Add(new ApprovalChange("Expense", null, item.Name));
                break;
            case SafeTransactionKind.TaxPayment:
            {
                var taxOwed = await safe.TaxOwedAsync(cancellationToken);
                summary = $"Tax payment · {amount}";
                changes.Add(new ApprovalChange("Tax owed · الضريبة المستحقة", Money(taxOwed), Money(taxOwed - voucher.Amount)));
                break;
            }
            case SafeTransactionKind.SupplierPayment:
                var supplier = await SupplierAsync(voucher.SupplierId, cancellationToken);
                var owed = await suppliersLedger.BalanceAsync(supplier.Id, cancellationToken);
                var paidFrom = voucher.RevenueDate is { } takings ? $"the takings of {Day(takings)}" : "the safe";
                summary = $"Supplier payment · {supplier.Name} · {amount}{(voucher.RevenueDate is null ? "" : $" from {paidFrom}")}";
                changes.Add(new ApprovalChange($"Owed to {supplier.Name}", Money(owed), Money(owed - voucher.Amount)));
                changes.Add(new ApprovalChange("Paid from", null, paidFrom));
                break;
            case SafeTransactionKind.InvoicePayment:
                var invoice = await UnpaidInvoiceAsync(voucher.PurchaseInvoiceId, cancellationToken);
                var name = invoice.SupplierId is { } id ? (await suppliers.GetByIdAsync(id, cancellationToken))?.Name : null;
                var fromWhere = invoice.RevenueDate is { } day ? $"the takings of {Day(day)}" : "the safe";
                summary = $"{(invoice.SupplierInvoiceNumber is { } number ? $"Invoice {number}" : "Invoice")}" +
                          $"{(name is null ? "" : $" · {name}")} paid from {fromWhere} · {Money(invoice.Total)}";
                changes.Add(new ApprovalChange("Paid from", null, fromWhere));
                break;
            case SafeTransactionKind.EmployeeAdvance when voucher.EmployeeId is null:
            {
                var advanceFrom = voucher.RevenueDate is { } advanceDay ? $"the takings of {Day(advanceDay)}" : "the safe";
                summary = $"Advances, not given out yet · {amount}{(voucher.RevenueDate is null ? "" : $" from {advanceFrom}")}";
                changes.Add(new ApprovalChange("Employee", null, "None named: shared among the staff"));
                changes.Add(new ApprovalChange("Paid from", null, advanceFrom));
                break;
            }
            case SafeTransactionKind.EmployeeAdvance:
            {
                var employee = await EmployeeAsync(voucher.EmployeeId, cancellationToken);
                var advanceFrom = voucher.RevenueDate is { } advanceDay ? $"the takings of {Day(advanceDay)}" : "the safe";
                summary = $"Employee advance · {employee.Name} · {amount}{(voucher.RevenueDate is null ? "" : $" from {advanceFrom}")}";
                changes.Add(new ApprovalChange("Employee", null, employee.Name));
                changes.Add(new ApprovalChange("Paid from", null, advanceFrom));
                changes.Add(new ApprovalChange("Deducted from the pay of", null, MonthName(PayMonthOf(voucher.Date))));
                break;
            }
            case SafeTransactionKind.SalaryPayment:
            {
                var (employee, month) = await SalaryAsync(voucher, cancellationToken);
                var salaryFrom = voucher.RevenueDate is { } salaryDay ? $"the takings of {Day(salaryDay)}" : "the safe";
                summary = $"Salary · {employee.Name} · {MonthName(month)} · {amount}{(voucher.RevenueDate is null ? "" : $" from {salaryFrom}")}";
                changes.Add(new ApprovalChange("Employee", null, employee.Name));
                changes.Add(new ApprovalChange("For the pay of", null, MonthName(month)));
                changes.Add(new ApprovalChange("Paid from", null, salaryFrom));
                break;
            }
            case SafeTransactionKind.PayrollPayment:
            {
                var run = await PayrollRunAsync(voucher.PayrollRunId, cancellationToken);
                summary = $"Payroll from HR · {run.PeriodName} · {amount}";
                changes.Add(new ApprovalChange("Payroll of", null, run.PeriodName));
                changes.Add(new ApprovalChange("Employees", null, run.Employees.ToString(Invariant)));
                changes.Add(new ApprovalChange("Advances already paid", null, Money(run.TotalAdvancesDeducted)));
                break;
            }
            default:
                throw new DomainException("Say what the safe entry is.");
        }

        changes.Insert(1, voucher.Kind == SafeTransactionKind.RevenueTransfer
            ? new ApprovalChange("Cash · الكاش", null, Money(Takings(voucher).Cash))
            : new ApprovalChange("Amount", null, amount));
        // What the safe holds after it: a payment out of a day's takings moves it once they are in it.
        var fromDrawer = voucher.RevenueDate is not null && SafeTransaction.PaidOutKinds.Contains(voucher.Kind)
            && !await TakingsInSafeAsync(voucher.RevenueDate, cancellationToken);
        decimal? moves = voucher.Kind switch
        {
            _ when fromDrawer => null,
            SafeTransactionKind.OpeningBalance or SafeTransactionKind.Funding => voucher.Amount,
            SafeTransactionKind.RevenueTransfer => Takings(voucher) is var (cash, card, tax)
                ? cash + card + tax - await safe.PaidOutOfTakingsAsync(voucher.RevenueDate!.Value, cancellationToken)
                : 0,
            _ => -voucher.Amount,
        };
        if (moves is { } by)
        {
            var balance = await safe.SafeBalanceAsync(null, cancellationToken);
            changes.Add(new ApprovalChange("Safe", Money(balance), Money(balance + by)));
        }

        if (!string.IsNullOrWhiteSpace(voucher.Notes))
            changes.Add(new ApprovalChange("Notes", null, voucher.Notes.Trim()));
        return (summary, changes);
    }

    // The same, for an entry already made: what voiding it is about.
    public async Task<string> DescribeAsync(SafeTransaction entry, CancellationToken cancellationToken)
    {
        var what = entry.Kind switch
        {
            SafeTransactionKind.OpeningBalance => $"Opening balance · {SourceName(entry.Source)}",
            SafeTransactionKind.Funding => $"Funding · {SourceName(entry.Source)}",
            SafeTransactionKind.RevenueTransfer => $"Takings of {Day(entry.RevenueDate!.Value)} · {Money(entry.GrossAmount ?? entry.Amount)} cash" +
                (entry.CardAmount != 0 ? $", {Money(entry.CardAmount)} card" : "") + (entry.TaxAmount != 0 ? $", {Money(entry.TaxAmount)} tax" : ""),
            SafeTransactionKind.ExpenseVoucher => $"Expense voucher · {(entry.ExpenseItemId is { } e ? (await expenses.GetByIdAsync(e, cancellationToken))?.Name : null) ?? "an expense"}",
            SafeTransactionKind.TaxPayment => "Tax payment",
            SafeTransactionKind.SupplierPayment => $"Supplier payment · {(entry.SupplierId is { } s ? (await suppliers.GetByIdAsync(s, cancellationToken))?.Name : null) ?? "a supplier"}" +
                (entry.RevenueDate is { } paidFrom ? $" from the takings of {Day(paidFrom)}" : ""),
            SafeTransactionKind.EmployeeAdvance when entry.EmployeeId is null => "Advances, not given out yet" + From(entry.RevenueDate),
            SafeTransactionKind.EmployeeAdvance => $"Employee advance · {await EmployeeNameAsync(entry.EmployeeId, cancellationToken)}" + From(entry.RevenueDate),
            SafeTransactionKind.SalaryPayment => $"Salary · {await EmployeeNameAsync(entry.EmployeeId, cancellationToken)}" +
                (entry.PayrollMonth is { } month ? $" · {MonthName(month)}" : "") + From(entry.RevenueDate),
            SafeTransactionKind.PayrollPayment => $"Payroll from HR · {(entry.PayrollMonth is { } paid ? MonthName(paid) : "a month")}",
            _ => $"Invoice payment from {(entry.RevenueDate is { } day ? $"the takings of {Day(day)}" : "the safe")}",
        };
        return $"{what} · {Money(Math.Abs(entry.Amount))} · {Day(entry.BusinessDate)}";
    }

    // The pay an advance paid on `date` comes off: its month's. The pay itself is worked out in
    // the HR system.
    public static DateOnly PayMonthOf(DateOnly date) => new(date.Year, date.Month, 1);

    // A salary's employee and the month whose pay it is: paid as entered, the pay itself being
    // the HR system's.
    private async Task<(StaffMember Employee, DateOnly Month)> SalaryAsync(SafeVoucher voucher, CancellationToken cancellationToken)
    {
        var employee = await EmployeeAsync(voucher.EmployeeId, cancellationToken);
        var month = voucher.PayrollMonth is { } chosen
            ? (chosen.Day == 1 ? chosen : throw new DomainException("A pay month is named by its first day."))
            : throw new DomainException("Choose the month whose pay this is.");
        return (employee, month);
    }

    // A payroll run from HR still to be paid.
    private async Task<PayrollRun> PayrollRunAsync(Guid? id, CancellationToken cancellationToken)
    {
        var run = id is { } runId
            ? await payrollRuns.GetByIdAsync(runId, cancellationToken) ?? throw new NotFoundException("Payroll run", runId)
            : throw new DomainException("Choose the payroll run to pay.");
        return run.IsDisbursed ? throw new DomainException($"The payroll of {run.PeriodName} is paid already. · المسير مصروف بالفعل.") : run;
    }

    private async Task<StaffMember> EmployeeAsync(Guid? id, CancellationToken cancellationToken) =>
        id is { } employeeId
            ? await employees.GetByIdAsync(employeeId, cancellationToken) ?? throw new NotFoundException("Staff member", employeeId)
            : throw new DomainException("Choose the employee.");

    private async Task<string> EmployeeNameAsync(Guid? id, CancellationToken cancellationToken) =>
        (id is { } employeeId ? (await employees.GetByIdAsync(employeeId, cancellationToken))?.Name : null) ?? "an employee";

    private static string From(DateOnly? revenueDate) => revenueDate is { } day ? $" from the takings of {Day(day)}" : "";

    private static string MonthName(DateOnly month) => month.ToString("MMMM yyyy", Invariant);

    // Whether a day's takings are entered, and so in the safe: what is paid out of them, or put
    // back, moves the safe.
    private async Task<bool> TakingsInSafeAsync(DateOnly? revenueDate, CancellationToken cancellationToken) =>
        revenueDate is { } day && await safe.GetTakingsAsync(day, cancellationToken) is not null;

    private async Task<Supplier> SupplierAsync(Guid? id, CancellationToken cancellationToken) =>
        id is { } supplierId
            ? await suppliers.GetByIdAsync(supplierId, cancellationToken) ?? throw new NotFoundException(nameof(Supplier), supplierId)
            : throw new DomainException("Choose the supplier.");

    private async Task<ExpenseItem> ExpenseItemAsync(Guid? id, CancellationToken cancellationToken)
    {
        if (id is not { } itemId)
            throw new DomainException("Choose what the expense is.");
        var item = await expenses.GetByIdAsync(itemId, cancellationToken) ?? throw new NotFoundException(nameof(ExpenseItem), itemId);
        return item.IsArchived ? throw new DomainException($"{item.Name} is archived. Restore it on the Expense items tab to use it again.") : item;
    }

    // A posted invoice paid in cash and not paid yet.
    private async Task<PurchaseInvoice> UnpaidInvoiceAsync(Guid? id, CancellationToken cancellationToken)
    {
        if (id is not { } invoiceId)
            throw new DomainException("Choose the invoice.");
        var invoice = _posting.GetValueOrDefault(invoiceId)
            ?? await invoices.GetByIdAsync(invoiceId, cancellationToken)
            ?? throw new NotFoundException(nameof(PurchaseInvoice), invoiceId);
        if (invoice.Status != PurchaseInvoiceStatus.Posted)
            throw new DomainException(invoice.Status == PurchaseInvoiceStatus.Voided ? "This invoice has been voided." : "Post the invoice first.");
        if (invoice.PaymentMethod is not (PurchasePaymentMethod.Safe or PurchasePaymentMethod.DayRevenue))
            throw new DomainException("This invoice is not paid in cash.");
        if (await safe.GetPaymentOfInvoiceAsync(invoice.Id, cancellationToken) is not null)
            throw new DomainException("This invoice has already been paid.");
        return invoice;
    }

    private static string SourceName(FundingSource? source) => source switch
    {
        FundingSource.CarriedOver => "carried over",
        FundingSource.OwnerFinancing => "owners' financing",
        _ => "other source",
    };

    private static string Money(decimal value) => CompanyMoney.Text(value);

    // A day's takings as the safe will keep them: the cash and card before tax, and the tax on them.
    private static (decimal Cash, decimal Card, decimal Tax) Takings(SafeVoucher voucher) =>
        SafeTransaction.Takings(voucher.Amount, voucher.CardAmount ?? 0, voucher.TaxAmount, voucher.IncludesTax ? voucher.TaxPercent : null);

    private static string Day(DateOnly day) => day.ToString("d MMM yyyy", Invariant);
}

// A safe entry: entered at once for a manager (Transaction), asked of a manager for anyone else
// (Request). RequestId is made by the till: a retry finds what was made.
public sealed record RecordSafeVoucherCommand(
    Guid RequestId, SafeVoucher Voucher, string? Reason, string StaffId, string StaffName, bool CanApprove)
    : IRequest<SafeVoucherResultDto>, IRetryOnConflict;

public sealed record SafeVoucherResultDto(ApprovalOutcome Outcome, SafeTransactionDto? Transaction, ApprovalRequestDto? Request);

internal sealed class RecordSafeVoucherHandler(
    TreasuryWriter treasury,
    ISafeTransactionRepository safe,
    IApprovalRequestRepository requests,
    IUnitOfWork unitOfWork) : IRequestHandler<RecordSafeVoucherCommand, SafeVoucherResultDto>
{
    public async Task<SafeVoucherResultDto> Handle(RecordSafeVoucherCommand request, CancellationToken cancellationToken)
    {
        if (await safe.GetByIdAsync(request.Voucher.TransactionId, cancellationToken) is { } made)
            return new SafeVoucherResultDto(ApprovalOutcome.Applied, SafeTransactionDto.From(made), null);
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } already)
            return new SafeVoucherResultDto(ApprovalOutcome.Requested, null, ApprovalRequestDto.From(already));
        if (request.Voucher.Kind == SafeTransactionKind.InvoicePayment)
            throw new DomainException("An invoice is paid from the invoice itself.");
        if (request.Voucher.Kind == SafeTransactionKind.PayrollPayment)
            throw new DomainException("A payroll from HR is paid from Financials → Staff → Payroll from HR.");
        var voucher = await treasury.WithTaxRateAsync(request.Voucher, cancellationToken);

        if (request.CanApprove)
        {
            var entry = await treasury.ApplyAsync(voucher, request.StaffName, null, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return new SafeVoucherResultDto(ApprovalOutcome.Applied, SafeTransactionDto.From(entry), null);
        }

        await treasury.CheckAsync(voucher, cancellationToken);
        var (summary, changes) = await treasury.DescribeAsync(voucher, cancellationToken);
        var asked = ApprovalRequest.AskToChange(
            request.RequestId, ApprovalModule.Treasury, ApprovalAction.Create, voucher.TransactionId, summary, changes,
            ApprovalPayload.Write(voucher), request.Reason, request.StaffId, request.StaffName);
        requests.Add(asked);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new SafeVoucherResultDto(ApprovalOutcome.Requested, null, ApprovalRequestDto.From(asked));
    }
}

// What a supplier was owed when the treasury started, from invoices before it. No cash moves, so
// it is entered at once. EntryId is made by the till.
public sealed record SetSupplierOpeningBalanceCommand(Guid EntryId, Guid SupplierId, decimal Owed, DateOnly Date, string StaffName)
    : IRequest, IRetryOnConflict;

internal sealed class SetSupplierOpeningBalanceHandler(
    ISupplierLedgerRepository ledger, ISupplierRepository suppliers, IUnitOfWork unitOfWork)
    : IRequestHandler<SetSupplierOpeningBalanceCommand>
{
    public async Task Handle(SetSupplierOpeningBalanceCommand request, CancellationToken cancellationToken)
    {
        if (await ledger.GetByIdAsync(request.EntryId, cancellationToken) is not null)
            return;
        _ = await suppliers.GetByIdAsync(request.SupplierId, cancellationToken) ?? throw new NotFoundException(nameof(Supplier), request.SupplierId);
        ledger.Add(SupplierLedgerEntry.Opening(request.EntryId, request.SupplierId, request.Owed, request.Date, request.StaffName));
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}

// Where an invoice's payment stands, for the screens.
public enum InvoicePaymentStatus
{
    // A draft: nothing is due yet.
    NotPosted = 1,

    // Paid in cash, from the safe or a day's takings.
    Paid = 2,

    // Its cash payment waits for a manager's approval.
    Pending = 3,

    // To be paid in cash, and not paid: its payment was rejected or voided.
    Unpaid = 4,

    // Owed to its supplier: see the supplier's account for what is paid.
    OnCredit = 5,

    // Posted before the treasury was kept.
    BeforeTreasury = 6,
}

public static class InvoicePayments
{
    public static InvoicePaymentStatus StatusOf(PurchaseInvoice invoice, bool paid, bool pending) => invoice switch
    {
        { Status: PurchaseInvoiceStatus.Draft } => InvoicePaymentStatus.NotPosted,
        { PaymentMethod: PurchasePaymentMethod.Credit } => InvoicePaymentStatus.OnCredit,
        { PaymentMethod: PurchasePaymentMethod.BeforeTreasury or null } => InvoicePaymentStatus.BeforeTreasury,
        _ when paid => InvoicePaymentStatus.Paid,
        _ when pending => InvoicePaymentStatus.Pending,
        { Total: <= 0 } => InvoicePaymentStatus.Paid,
        _ => InvoicePaymentStatus.Unpaid,
    };

    public static async Task<InvoicePaymentStatus> StatusAsync(
        PurchaseInvoice invoice, ISafeTransactionRepository safe, IApprovalRequestRepository requests, CancellationToken cancellationToken) =>
        StatusOf(
            invoice,
            await safe.GetPaymentOfInvoiceAsync(invoice.Id, cancellationToken) is not null,
            await requests.GetPendingForAsync(invoice.Id, cancellationToken) is { Module: ApprovalModule.Treasury });
}

// Pays a posted cash invoice that is not paid (its payment was rejected or voided): from the safe
// or a day's takings, for a manager at once and asked of one for anyone else; or onto credit,
// owed to its supplier.
public sealed record PayPurchaseInvoiceCommand(
    Guid RequestId, Guid InvoiceId, PurchasePaymentMethod Method, DateOnly? RevenueDate, string StaffId, string StaffName, bool CanApprove)
    : IRequest<InvoicePaymentStatus>, IRetryOnConflict;

internal sealed class PayPurchaseInvoiceHandler(
    IPurchaseInvoiceRepository invoices,
    ISafeTransactionRepository safe,
    IApprovalRequestRepository requests,
    TreasuryWriter treasury,
    IUnitOfWork unitOfWork) : IRequestHandler<PayPurchaseInvoiceCommand, InvoicePaymentStatus>
{
    public async Task<InvoicePaymentStatus> Handle(PayPurchaseInvoiceCommand request, CancellationToken cancellationToken)
    {
        var invoice = await invoices.GetRequiredAsync(request.InvoiceId, cancellationToken);
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is not null)
            return await InvoicePayments.StatusAsync(invoice, safe, requests, cancellationToken);
        var status = await InvoicePayments.StatusAsync(invoice, safe, requests, cancellationToken);
        if (status != InvoicePaymentStatus.Unpaid)
            throw new DomainException(status switch
            {
                InvoicePaymentStatus.Paid => "This invoice has already been paid.",
                InvoicePaymentStatus.Pending => "This invoice's payment is waiting for a manager's approval.",
                InvoicePaymentStatus.OnCredit => "This invoice is on credit: pay the supplier with a payment voucher.",
                _ => "This invoice is not one to pay here.",
            });

        invoice.PayBy(request.Method, request.RevenueDate);
        await treasury.SettleAsync(invoice, request.RequestId, request.StaffId, request.StaffName, request.CanApprove, requests, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await InvoicePayments.StatusAsync(invoice, safe, requests, cancellationToken);
    }
}
