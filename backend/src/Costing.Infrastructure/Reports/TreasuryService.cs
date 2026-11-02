using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Sales;
using Costing.Domain.Purchases;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// One line of the safe's ledger as the screens show it: what it was, in or out, and the balance
// after it. A reversal names what it undid (ReversalOf); what it undid is marked voided.
public sealed record SafeEntryRow(
    Guid Id,
    SafeTransactionKind Kind,
    CashFund Fund,
    DateOnly Date,
    string Description,
    decimal In,
    decimal Out,
    decimal? Balance,
    FundingSource? Source,
    DateOnly? RevenueDate,
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
    // A day's takings entered with the tax in them: the rate, and the tax in their gross (signed as
    // In and Out are: a voided entry's reversal takes it back).
    bool IncludesTax = false,
    decimal? TaxPercent = null,
    decimal Tax = 0,
    // A day's takings: their cash, as entered; In is what of it reached the safe. Their card
    // takings, settled to the bank, and the day's voids and refunds, said.
    decimal? Gross = null,
    decimal Card = 0,
    decimal Voids = 0);

// How a month's opening balance came about: carried over from the month before (رصيد مرحل), the
// treasury's own opening entry, made this month, or none yet.
public enum SafeOpening
{
    None = 0,
    CarriedOver = 1,
    OpeningEntry = 2,
}

// The safe in one month: the balance it opened with and why, what came in and went out, the
// balance it closed with; and the balance now.
public sealed record SafeMonth(
    int Year,
    int Month,
    DateOnly From,
    DateOnly To,
    decimal OpeningBalance,
    SafeOpening OpeningKind,
    // The opening entry's source, when the treasury opened this month.
    FundingSource? OpeningSource,
    // What stands: an entry voided this month, and its void, are in neither.
    decimal In,
    decimal Out,
    // The entries voided this month, money in and money out: left out of In and Out with their voids.
    decimal VoidedIn,
    decimal VoidedOut,
    decimal ClosingBalance,
    decimal BalanceNow,
    bool HasOpeningBalance,
    IReadOnlyList<SafeEntryRow> Entries);

// Money put into the safe, by where it came from, over a period.
public sealed record FundingReport(
    DateOnly From,
    DateOnly To,
    decimal CarriedOver,
    decimal OwnerFinancing,
    decimal Other,
    decimal Revenue,
    decimal Total,
    IReadOnlyList<SafeEntryRow> Entries);

// One business day's cash: what the till and cash-on-delivery took, the takings entered for it
// (gross), what was paid straight out of them, what of them went into the safe, and what is left:
// the till's cash not entered as takings (below zero, more was entered than the till took). Only
// from the treasury's opening on.
// One business day's takings as its Z report gave them: the cash and the card, the tax collected
// in them, and so the net sales (Cash + Card − Tax); the voids, said; what was paid straight out of
// the cash, and what of it is in the safe. Entered: the takings are; HasSales: the day's sales are.
public sealed record DayRevenue(
    DateOnly Date, decimal Cash, decimal Card, decimal Tax, decimal NetSales, decimal Voids, decimal PaidOut, decimal Transferred, bool Entered,
    bool HasSales);

public sealed record DayRevenueReport(
    DateOnly From, DateOnly To, decimal Cash, decimal Card, decimal Tax, decimal NetSales, decimal Voids, decimal PaidOut, decimal Transferred,
    IReadOnlyList<DayRevenue> Days);

// Each day's takings as they were spent (يومية الإيراد): the gross entered for them (Gross), the
// invoices paid straight out of them (Deductions), and what is left of them in the safe
// (NetToSafe). A line is one invoice paid, with what it bought, the dearest first; or the takings
// entered, at their gross.
public sealed record DailyCashLine(
    Guid Id, SafeTransactionKind Kind, DateOnly Date, string Description, decimal Amount, Guid? PurchaseInvoiceId, IReadOnlyList<string> Items,
    string RecordedBy, string? ApprovedBy);

public sealed record DailyCashDay(
    DateOnly Date, decimal Gross, decimal Deductions, decimal NetToSafe, IReadOnlyList<DailyCashLine> Paid, IReadOnlyList<DailyCashLine> Entered);

// A day's takings as they stand before they are entered: the gross already entered for them, if
// any; and what was paid straight out of them, invoices and supplier payments, which entering them
// takes off.
public sealed record TakingsPreview(DateOnly Date, decimal? Entered, decimal PaidOut, int Invoices, int SupplierPayments, int EmployeePayments = 0);

public sealed record DailyCashReport(DateOnly From, DateOnly To, decimal Gross, decimal Deductions, decimal NetToSafe, IReadOnlyList<DailyCashDay> Days);

public sealed record ExpenseVoucherRow(
    Guid Id, DateOnly Date, Guid ExpenseItemId, string ExpenseItem, string? Category, decimal Amount, string? Notes, string RecordedBy, string? ApprovedBy,
    DateTime? VoidedAtUtc, string? VoidedBy);

public sealed record ExpenseVoucherReport(DateOnly From, DateOnly To, decimal Total, IReadOnlyList<ExpenseVoucherRow> Vouchers);

// What is owed to one supplier, and how it came about.
public sealed record SupplierBalance(
    Guid SupplierId, string Supplier, bool IsArchived, decimal OpeningDebt, decimal CreditPurchases, decimal Payments, decimal Balance,
    DateOnly? LastPaidOn, int OpenInvoices);

// A line of a supplier's statement (كشف حساب): Owed adds to the debt, Paid takes from it.
public sealed record SupplierStatementLine(
    Guid Id, DateOnly Date, SupplierLedgerKind Kind, string Description, decimal Owed, decimal Paid, decimal Balance, Guid SourceId, bool IsReversal);

public enum OpenInvoiceStatus
{
    Unpaid = 1,
    PartlyPaid = 2,
}

// A credit invoice not fully paid: payments are set against the opening debt first, then the
// invoices oldest first.
public sealed record OpenInvoice(
    Guid InvoiceId, string? SupplierInvoiceNumber, DateOnly Date, decimal Total, decimal Paid, decimal Remaining, OpenInvoiceStatus Status);

public sealed record SupplierStatement(
    Guid SupplierId,
    string Supplier,
    decimal OpeningDebt,
    decimal CreditPurchases,
    decimal Payments,
    decimal Balance,
    IReadOnlyList<SupplierStatementLine> Lines,
    IReadOnlyList<OpenInvoice> OpenInvoices);

// FromTakingsOf: paid straight out of that day's takings, not the safe.
public sealed record SupplierPaymentRow(
    Guid Id, DateOnly Date, Guid SupplierId, string Supplier, decimal Amount, string? Notes, string RecordedBy, string? ApprovedBy,
    DateTime? VoidedAtUtc, string? VoidedBy, DateOnly? FromTakingsOf = null);

// An employee's advance (سلفة): when and from where it was paid, and the payroll month whose slip
// deducts it.
// No employee and no payroll month: advances handed out with no one named, given out on HR →
// Advances.
public sealed record AdvanceRow(
    Guid Id, DateOnly Date, Guid? EmployeeId, string Employee, decimal Amount, DateOnly? PayrollMonth, DateOnly? FromTakingsOf, string? Notes,
    string RecordedBy, string? ApprovedBy, DateTime? VoidedAtUtc, string? VoidedBy);

// Tax and service (إعدادات الضريبة والخدمة): the till's tax rate, as the delivery system set it (null
// until it has synced, when the till cannot price a bill either), and the service charge.
public sealed record FinancialSettingsDto(decimal? TaxPercent, decimal ServicePercent, string? UpdatedBy, DateTime? UpdatedAtUtc);

// The tax rate left out of a save stays as it is.
public sealed record SaveFinancialSettingsRequest(decimal ServicePercent, decimal? TaxPercent = null);

// One business day of the reconciliation (مطابقة الإيرادات), or the period's total (no Date).
//
// The takings (A): the day's cash and card as its Z report gave them, less the tax collected in
// them: its net sales. The sales (B): every item of the day's sales summary at its menu price,
// before tax (a bill entered as printed: what it charged before tax, less what was handed back).
//
// Difference: A less B. Below zero, the takings fall short of what was sold at the menu's prices
// (discounts, staff meals, cash missing); above it, money came in for items not entered.
public sealed record ReconciliationDay(
    DateOnly? Date,
    decimal Cash,
    decimal Card,
    decimal Tax,
    decimal NetSales,
    decimal Voids,
    decimal ItemSales,
    decimal Difference);

public sealed record ReconciliationReport(DateOnly From, DateOnly To, decimal? TaxPercent, ReconciliationDay Total, IReadOnlyList<ReconciliationDay> Days);

// The treasury's reports, read straight from the ledgers: the safe, where its money came from, each
// day's cash and its reconciliation with the sales, the expense vouchers, and what is owed to
// suppliers. And its tax and service settings.
public sealed class TreasuryService(CostingDbContext db, IBusinessCalendar clock, SalesLedger ledger)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public DateOnly Today => clock.BusinessDateOf(DateTime.UtcNow);

    // ---- The safe ----

    public async Task<SafeMonth> GetSafeAsync(int year, int month, CancellationToken cancellationToken)
    {
        if (month is < 1 or > 12 || year is < 2000 or > 2100)
            throw new DomainException("Choose a month.");
        var from = new DateOnly(year, month, 1);
        var to = from.AddMonths(1).AddDays(-1);

        var safe = db.SafeTransactions.AsNoTracking().Where(t => t.Fund == CashFund.Safe);
        var before = await safe.Where(t => t.BusinessDate < from).SumAsync(t => t.Amount, cancellationToken);
        var anyBefore = await safe.AnyAsync(t => t.BusinessDate < from, cancellationToken);
        var rows = await safe.Where(t => t.BusinessDate >= from && t.BusinessDate <= to)
            .OrderBy(t => t.BusinessDate).ThenBy(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var opening = rows.FirstOrDefault(t => t.Kind == SafeTransactionKind.OpeningBalance && !t.IsReversal);

        // An entry and its void, both this month, come to nothing: In and Out count neither, and
        // the entry is shown apart as voided. An earlier month's entry voided this month stays in
        // that month, which closed with it, and its void counts here, where it was made.
        var ids = rows.Select(t => t.Id).ToHashSet();
        var cancelled = rows.Where(t => t.ReversalOf is { } original && ids.Contains(original))
            .SelectMany(t => new[] { t.Id, t.ReversalOf!.Value })
            .ToHashSet();
        var standing = rows.Where(t => !cancelled.Contains(t.Id)).ToList();
        var voided = rows.Where(t => cancelled.Contains(t.Id) && !t.IsReversal).ToList();

        var names = await NamesAsync(rows, cancellationToken);
        var balance = before;
        var entries = rows.Select(t =>
        {
            balance += t.Amount;
            return Row(t, names, balance);
        }).ToList();

        return new SafeMonth(
            year, month, from, to, Money(before),
            anyBefore ? SafeOpening.CarriedOver : opening is not null ? SafeOpening.OpeningEntry : SafeOpening.None,
            anyBefore ? null : opening?.Source,
            Money(standing.Where(t => t.Amount > 0).Sum(t => t.Amount)),
            Money(-standing.Where(t => t.Amount < 0).Sum(t => t.Amount)),
            Money(voided.Where(t => t.Amount > 0).Sum(t => t.Amount)),
            Money(-voided.Where(t => t.Amount < 0).Sum(t => t.Amount)),
            Money(balance),
            Money(await safe.SumAsync(t => t.Amount, cancellationToken)),
            await db.SafeTransactions.AnyAsync(t => t.Kind == SafeTransactionKind.OpeningBalance && t.ReversalOf == null && t.VoidedAtUtc == null, cancellationToken),
            entries);
    }

    // ---- Funding sources ----

    public async Task<FundingReport> GetFundingAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var rows = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Fund == CashFund.Safe && t.BusinessDate >= from && t.BusinessDate <= to
                && (t.Kind == SafeTransactionKind.OpeningBalance || t.Kind == SafeTransactionKind.Funding || t.Kind == SafeTransactionKind.RevenueTransfer))
            .OrderBy(t => t.BusinessDate).ThenBy(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var names = await NamesAsync(rows, cancellationToken);
        decimal Sum(Func<SafeTransaction, bool> which) => Money(rows.Where(which).Sum(t => t.Amount));
        return new FundingReport(
            from, to,
            Sum(t => t.Kind != SafeTransactionKind.RevenueTransfer && t.Source == FundingSource.CarriedOver),
            Sum(t => t.Kind != SafeTransactionKind.RevenueTransfer && t.Source == FundingSource.OwnerFinancing),
            Sum(t => t.Kind != SafeTransactionKind.RevenueTransfer && t.Source == FundingSource.Other),
            Sum(t => t.Kind == SafeTransactionKind.RevenueTransfer),
            Sum(_ => true),
            rows.Select(t => Row(t, names, null)).ToList());
    }

    // ---- Each day's cash ----

    // From the treasury's opening on, once it has one: the cash of the days before it is in the
    // opening balance, not still to be moved in.
    public async Task<DayRevenueReport> GetDayRevenueAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        from = await FromOpeningAsync(from, cancellationToken);
        if (from > to)
            return new DayRevenueReport(from, to, 0, 0, 0, 0, 0, 0, 0, []);
        var sold = (await db.SalesReceipts.AsNoTracking()
                .Where(r => r.VoidedAtUtc == null && r.BusinessDate >= from && r.BusinessDate <= to)
                .Select(r => r.BusinessDate)
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToHashSet();
        var moved = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.RevenueDate != null && t.RevenueDate >= from && t.RevenueDate <= to)
            .ToListAsync(cancellationToken);

        // Voids net out with what they undo, as they share its day.
        var days = sold.Concat(moved.Select(m => m.RevenueDate!.Value)).Distinct().OrderByDescending(d => d)
            .Select(day =>
            {
                var ofDay = moved.Where(m => m.RevenueDate == day).ToList();
                var takings = ofDay.Where(m => m.Kind == SafeTransactionKind.RevenueTransfer).ToList();
                var (cash, card, tax) = (takings.Sum(m => m.GrossAmount ?? m.Amount), takings.Sum(m => m.CardAmount), takings.Sum(m => m.TaxAmount));
                var paid = -ofDay.Where(m => SafeTransaction.PaidOutKinds.Contains(m.Kind)).Sum(m => m.Amount);
                // What of the day's cash is in the safe: the cash less what the drawer had paid by
                // then, less what was paid out of the safe for it since.
                var transferred = ofDay.Where(m => m.Fund == CashFund.Safe).Sum(m => m.Amount);
                return new DayRevenue(
                    day, Money(cash), Money(card), Money(tax), Money(cash + card - tax), Money(takings.Sum(m => m.VoidsAmount)), Money(paid),
                    Money(transferred), takings.Any(m => !m.IsReversal && !m.IsVoided), sold.Contains(day));
            })
            .Where(d => d.Entered || d.HasSales || d.PaidOut != 0)
            .ToList();
        return new DayRevenueReport(
            from, to, Money(days.Sum(d => d.Cash)), Money(days.Sum(d => d.Card)), Money(days.Sum(d => d.Tax)), Money(days.Sum(d => d.NetSales)),
            Money(days.Sum(d => d.Voids)), Money(days.Sum(d => d.PaidOut)), Money(days.Sum(d => d.Transferred)), days);
    }

    // A day's takings before they are entered: the Takings in screen shows what will be taken off.
    public async Task<TakingsPreview> GetTakingsPreviewAsync(DateOnly day, CancellationToken cancellationToken)
    {
        var entries = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.RevenueDate == day && (t.Kind == SafeTransactionKind.RevenueTransfer || t.Fund == CashFund.DayRevenue))
            .ToListAsync(cancellationToken);
        var entered = entries.FirstOrDefault(t => t.Kind == SafeTransactionKind.RevenueTransfer && !t.IsReversal && !t.IsVoided);
        var drawer = entries.Where(t => t.Fund == CashFund.DayRevenue).ToList();
        var standing = drawer.Where(t => !t.IsReversal && !t.IsVoided).ToList();
        return new TakingsPreview(
            day, entered is null ? null : Money(entered.TakingsTotal), Money(-drawer.Sum(t => t.Amount)),
            standing.Count(t => t.Kind == SafeTransactionKind.InvoicePayment), standing.Count(t => t.Kind == SafeTransactionKind.SupplierPayment),
            standing.Count(t => t.Kind is SafeTransactionKind.EmployeeAdvance or SafeTransactionKind.SalaryPayment));
    }

    // Each day of the period whose takings paid an invoice, a supplier or an employee, or were
    // counted into the safe, latest first. A voided entry and its void are both of the entry's day, and come to nothing: neither
    // is listed. Read only: the safe and the takings are as they were.
    public async Task<DailyCashReport> GetDailyCashAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var rows = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.RevenueDate != null && t.RevenueDate >= from && t.RevenueDate <= to
                && (t.Kind == SafeTransactionKind.RevenueTransfer || SafeTransaction.PaidOutKinds.Contains(t.Kind)))
            .OrderBy(t => t.BusinessDate).ThenBy(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var standing = rows.Where(t => !t.IsReversal && !t.IsVoided).ToList();

        var names = await NamesAsync(standing, cancellationToken);
        var invoiceIds = standing.Where(t => t.PurchaseInvoiceId != null).Select(t => t.PurchaseInvoiceId!.Value).Distinct().ToList();
        var invoices = await db.PurchaseInvoices.AsNoTracking().Include(i => i.Lines)
            .Where(i => invoiceIds.Contains(i.Id))
            .ToDictionaryAsync(i => i.Id, cancellationToken);
        var materialIds = invoices.Values.SelectMany(i => i.Lines).Where(l => l.RawMaterialId != null).Select(l => l.RawMaterialId!.Value).Distinct().ToList();
        var materials = await db.RawMaterials.AsNoTracking().Where(m => materialIds.Contains(m.Id))
            .ToDictionaryAsync(m => m.Id, m => m.Name, cancellationToken);

        DailyCashLine Line(SafeTransaction t)
        {
            if (t.Kind == SafeTransactionKind.RevenueTransfer)
                return new DailyCashLine(t.Id, t.Kind, t.BusinessDate, "Takings entered", Money(t.GrossAmount ?? t.Amount), null, [], t.RecordedBy, t.ApprovedBy);
            // An employee's advance or salary: who, and the notes as what it was for.
            if (t.Kind is SafeTransactionKind.EmployeeAdvance or SafeTransactionKind.SalaryPayment)
                return new DailyCashLine(
                    t.Id, t.Kind, t.BusinessDate,
                    t.EmployeeId is { } who
                        ? $"{(t.Kind == SafeTransactionKind.EmployeeAdvance ? "Advance to" : "Salary of")} {names.Employees.GetValueOrDefault(who) ?? "a removed employee"}"
                        : "Advances, not given out yet",
                    Money(-t.Amount), null, t.Notes is { } said ? [said] : [], t.RecordedBy, t.ApprovedBy);
            // An old debt paid: the supplier, and the notes (a receipt number) as what it was for.
            if (t.Kind == SafeTransactionKind.SupplierPayment)
                return new DailyCashLine(
                    t.Id, t.Kind, t.BusinessDate, $"Payment to {names.Suppliers.GetValueOrDefault(t.SupplierId!.Value) ?? "a removed supplier"}",
                    Money(-t.Amount), null, t.Notes is { } notes ? [notes] : [], t.RecordedBy, t.ApprovedBy);

            var invoice = t.PurchaseInvoiceId is { } id ? invoices.GetValueOrDefault(id) : null;
            var what = invoice?.SupplierInvoiceNumber is { } number ? $"Invoice {number}"
                : invoice?.InvoiceDate is { } date ? $"Invoice of {date.ToString("d MMM", Invariant)}"
                : "Invoice";
            if ((invoice?.SupplierId ?? t.SupplierId) is { } supplier)
                what += $" · {names.Suppliers.GetValueOrDefault(supplier) ?? "a removed supplier"}";
            var items = invoice is null ? [] : invoice.Lines
                .OrderByDescending(l => l.Cost ?? 0)
                .Select(l => l.RawMaterialId is { } m ? materials.GetValueOrDefault(m) ?? "A removed material"
                    : l.ExpenseItemId is { } e ? names.Expenses.GetValueOrDefault(e) ?? "A removed expense"
                    : "An item")
                .Distinct()
                .ToList();
            return new DailyCashLine(t.Id, t.Kind, t.BusinessDate, what, Money(-t.Amount), t.PurchaseInvoiceId, items, t.RecordedBy, t.ApprovedBy);
        }

        // The sums count every entry, voids too, so a void netting out with what it undid, or
        // putting cash back into the safe, is counted as it moved. The lines are what stands.
        var days = rows.GroupBy(t => t.RevenueDate!.Value).OrderByDescending(g => g.Key)
            .Select(g =>
            {
                var gross = g.Where(t => t.Kind == SafeTransactionKind.RevenueTransfer).Sum(t => t.GrossAmount ?? t.Amount);
                var deductions = -g.Where(t => SafeTransaction.PaidOutKinds.Contains(t.Kind)).Sum(t => t.Amount);
                var net = g.Where(t => t.Fund == CashFund.Safe).Sum(t => t.Amount);
                var lines = standing.Where(t => t.RevenueDate == g.Key).ToList();
                return new DailyCashDay(
                    g.Key, Money(gross), Money(deductions), Money(net),
                    lines.Where(t => t.Kind != SafeTransactionKind.RevenueTransfer).Select(Line).ToList(),
                    lines.Where(t => t.Kind == SafeTransactionKind.RevenueTransfer).Select(Line).ToList());
            })
            .Where(d => d.Paid.Count > 0 || d.Entered.Count > 0 || d.Gross != 0 || d.Deductions != 0 || d.NetToSafe != 0)
            .ToList();
        return new DailyCashReport(
            from, to, Money(days.Sum(d => d.Gross)), Money(days.Sum(d => d.Deductions)), Money(days.Sum(d => d.NetToSafe)), days);
    }

    // The first day of a period the treasury has kept: its opening day, when that is later.
    private async Task<DateOnly> FromOpeningAsync(DateOnly from, CancellationToken cancellationToken)
    {
        var opened = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.OpeningBalance && t.ReversalOf == null && t.VoidedAtUtc == null)
            .Select(t => (DateOnly?)t.BusinessDate)
            .FirstOrDefaultAsync(cancellationToken);
        return opened > from ? opened.Value : from;
    }

    // ---- Reconciliation: the cash against the sales ----

    // Each business day from the treasury's opening on, latest first: the takings entered for it
    // against the items sold that day (costing's sales: orders paid at the till by when they were
    // paid, and online orders).
    public async Task<ReconciliationReport> GetReconciliationAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var taxPercent = await TaxPercentAsync(cancellationToken);
        from = await FromOpeningAsync(from, cancellationToken);
        if (from > to)
            return new ReconciliationReport(from, to, taxPercent, Reconcile(null, [], []), []);

        var cash = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.RevenueDate != null && t.RevenueDate >= from && t.RevenueDate <= to
                && t.Kind == SafeTransactionKind.RevenueTransfer)
            .ToListAsync(cancellationToken);
        var (fromUtc, _) = clock.Bounds(from);
        var (_, toUtc) = clock.Bounds(to);
        var sales = (await ledger.GetAsync(fromUtc, toUtc, cancellationToken)).ToLookup(o => clock.BusinessDateOf(o.SoldAtUtc));

        // A day whose only entries were voided, with nothing sold, has nothing to reconcile.
        var days = cash.Select(t => t.RevenueDate!.Value).Concat(sales.Select(g => g.Key)).Distinct().OrderByDescending(d => d)
            .Select(day => Reconcile(day, cash.Where(t => t.RevenueDate == day).ToList(), sales[day].ToList()))
            .Where(d => d.Cash != 0 || d.Card != 0 || sales[d.Date!.Value].Any())
            .ToList();
        var total = new ReconciliationDay(
            null, Money(days.Sum(d => d.Cash)), Money(days.Sum(d => d.Card)), Money(days.Sum(d => d.Tax)), Money(days.Sum(d => d.NetSales)),
            Money(days.Sum(d => d.Voids)), Money(days.Sum(d => d.ItemSales)), Money(days.Sum(d => d.Difference)));
        return new ReconciliationReport(from, to, taxPercent, total, days);
    }

    private static ReconciliationDay Reconcile(DateOnly? day, IReadOnlyList<SafeTransaction> takings, IReadOnlyList<SaleOrder> sales)
    {
        // The takings, a voided entry netting out with its reversal: cash and card, less the tax
        // collected in them.
        var (cash, card, tax) = (takings.Sum(t => t.GrossAmount ?? t.Amount), takings.Sum(t => t.CardAmount), takings.Sum(t => t.TaxAmount));

        // The sales before tax: a day's summary at the menu's prices; a bill entered as printed,
        // what it charged before tax less what was handed back, in the same proportion.
        var items = sales.Sum(sale =>
        {
            var beforeTax = sale.Charged - sale.Tax;
            var refund = sale.Charged > 0 ? Math.Round(sale.Refunded * beforeTax / sale.Charged, 2, MidpointRounding.AwayFromZero) : 0;
            return beforeTax - refund;
        });

        var net = cash + card - tax;
        return new ReconciliationDay(
            day, Money(cash), Money(card), Money(tax), Money(net), Money(takings.Sum(t => t.VoidsAmount)), Money(items), Money(net - items));
    }

    // ---- Tax and service ----

    public async Task<FinancialSettingsDto> GetSettingsAsync(CancellationToken cancellationToken)
    {
        var row = await db.FinancialSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        return new FinancialSettingsDto(await TaxPercentAsync(cancellationToken), row?.ServicePercent ?? 0, row?.UpdatedBy, row?.UpdatedAtUtc);
    }

    public async Task<FinancialSettingsDto> SaveSettingsAsync(SaveFinancialSettingsRequest request, string by, CancellationToken cancellationToken)
    {
        if (request.ServicePercent is < 0 or >= 100)
            throw new DomainException("The service charge is a percentage from 0 up to 100.");
        if (request.TaxPercent is < 0 or >= 100)
            throw new DomainException("The tax is a percentage from 0 up to 100.");
        var row = await db.FinancialSettings.SingleOrDefaultAsync(cancellationToken);
        if (row is null)
            db.FinancialSettings.Add(row = new FinancialSettings());
        row.ServicePercent = Math.Round(request.ServicePercent, 2, MidpointRounding.AwayFromZero);
        if (request.TaxPercent is { } tax)
            row.TaxPercent = Math.Round(tax, 2, MidpointRounding.AwayFromZero);
        row.UpdatedBy = by;
        row.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return await GetSettingsAsync(cancellationToken);
    }

    // The bills' tax rate, as set on Tax & service, or null before it is.
    private async Task<decimal?> TaxPercentAsync(CancellationToken cancellationToken) =>
        (await db.FinancialSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken))?.TaxPercent;

    // ---- Expense vouchers ----

    public async Task<ExpenseVoucherReport> GetExpenseVouchersAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var vouchers = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.ExpenseVoucher && t.ReversalOf == null && t.BusinessDate >= from && t.BusinessDate <= to)
            .OrderByDescending(t => t.BusinessDate).ThenByDescending(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var items = await db.ExpenseItems.AsNoTracking().ToDictionaryAsync(e => e.Id, cancellationToken);
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);
        var rows = vouchers.Select(t =>
        {
            var item = items.GetValueOrDefault(t.ExpenseItemId!.Value);
            return new ExpenseVoucherRow(
                t.Id, t.BusinessDate, t.ExpenseItemId.Value, item?.Name ?? "A removed expense",
                item is null ? null : categories.GetValueOrDefault(item.CategoryId), Money(-t.Amount), t.Notes, t.RecordedBy, t.ApprovedBy,
                t.VoidedAtUtc, t.VoidedBy);
        }).ToList();
        return new ExpenseVoucherReport(from, to, Money(rows.Where(r => r.VoidedAtUtc is null).Sum(r => r.Amount)), rows);
    }

    // ---- What is owed to suppliers ----

    public async Task<IReadOnlyList<SupplierBalance>> GetSupplierBalancesAsync(CancellationToken cancellationToken)
    {
        var lines = await db.SupplierLedgerEntries.AsNoTracking().ToListAsync(cancellationToken);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, cancellationToken);
        return lines.GroupBy(l => l.SupplierId)
            .Select(g =>
            {
                var supplier = suppliers.GetValueOrDefault(g.Key);
                var (opening, credit, paid) = Totals(g);
                var open = OpenInvoices(g.ToList(), new Dictionary<Guid, PurchaseInvoice>()).Count;
                return new SupplierBalance(
                    g.Key, supplier?.Name ?? "A removed supplier", supplier?.IsArchived ?? false, opening, credit, paid, Money(opening + credit - paid),
                    g.Where(l => l.Kind == SupplierLedgerKind.Payment && !l.IsReversal).Select(l => (DateOnly?)l.BusinessDate).Max(), open);
            })
            .OrderByDescending(b => b.Balance)
            .ThenBy(b => b.Supplier, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public async Task<SupplierStatement?> GetSupplierStatementAsync(Guid supplierId, CancellationToken cancellationToken)
    {
        if (await db.Suppliers.AsNoTracking().SingleOrDefaultAsync(s => s.Id == supplierId, cancellationToken) is not { } supplier)
            return null;
        var lines = await db.SupplierLedgerEntries.AsNoTracking()
            .Where(l => l.SupplierId == supplierId)
            .OrderBy(l => l.BusinessDate).ThenBy(l => l.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var invoiceIds = lines.Where(l => l.Kind == SupplierLedgerKind.CreditInvoice).Select(l => l.SourceId).Distinct().ToList();
        var invoices = await db.PurchaseInvoices.AsNoTracking().Where(i => invoiceIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, cancellationToken);

        var balance = 0m;
        var statement = lines.Select(l =>
        {
            balance += l.Amount;
            return new SupplierStatementLine(
                l.Id, l.BusinessDate, l.Kind, Describe(l, invoices), l.Amount > 0 ? l.Amount : 0, l.Amount < 0 ? -l.Amount : 0, Money(balance), l.SourceId,
                l.IsReversal);
        }).ToList();
        var (opening, credit, paid) = Totals(lines);
        return new SupplierStatement(supplierId, supplier.Name, opening, credit, paid, Money(opening + credit - paid), statement, OpenInvoices(lines, invoices));
    }

    // The advances paid in a period, latest first, voided ones too (marked).
    public async Task<IReadOnlyList<AdvanceRow>> GetAdvancesAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var advances = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.EmployeeAdvance && t.ReversalOf == null && t.BusinessDate >= from && t.BusinessDate <= to)
            .OrderByDescending(t => t.BusinessDate).ThenByDescending(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var names = await db.Staff.AsNoTracking().ToDictionaryAsync(e => e.Id, e => e.Name, cancellationToken);
        return advances
            .Select(t => new AdvanceRow(
                t.Id, t.BusinessDate, t.EmployeeId,
                t.EmployeeId is { } id ? names.GetValueOrDefault(id) ?? "A removed employee" : "Not given out yet", Money(-t.Amount),
                t.PayrollMonth, t.RevenueDate, t.Notes, t.RecordedBy, t.ApprovedBy, t.VoidedAtUtc, t.VoidedBy))
            .ToList();
    }

    public async Task<IReadOnlyList<SupplierPaymentRow>> GetSupplierPaymentsAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var payments = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.SupplierPayment && t.ReversalOf == null && t.BusinessDate >= from && t.BusinessDate <= to)
            .OrderByDescending(t => t.BusinessDate).ThenByDescending(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var names = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);
        return payments
            .Select(t => new SupplierPaymentRow(
                t.Id, t.BusinessDate, t.SupplierId!.Value, names.GetValueOrDefault(t.SupplierId.Value) ?? "A removed supplier", Money(-t.Amount), t.Notes,
                t.RecordedBy, t.ApprovedBy, t.VoidedAtUtc, t.VoidedBy, t.RevenueDate))
            .ToList();
    }

    // Opening debt, credit purchases and payments, each net of what was undone.
    private static (decimal Opening, decimal Credit, decimal Paid) Totals(IEnumerable<SupplierLedgerEntry> lines)
    {
        var all = lines.ToList();
        return (
            Money(all.Where(l => l.Kind == SupplierLedgerKind.OpeningBalance).Sum(l => l.Amount)),
            Money(all.Where(l => l.Kind == SupplierLedgerKind.CreditInvoice).Sum(l => l.Amount)),
            Money(-all.Where(l => l.Kind == SupplierLedgerKind.Payment).Sum(l => l.Amount)));
    }

    // The credit invoices still owed, oldest first: what was paid is set against the opening debt,
    // then against each invoice in turn.
    private static IReadOnlyList<OpenInvoice> OpenInvoices(IReadOnlyList<SupplierLedgerEntry> lines, IReadOnlyDictionary<Guid, PurchaseInvoice> invoices)
    {
        var (opening, _, paid) = Totals(lines);
        var left = Math.Max(paid - opening, 0);
        var standing = lines
            .Where(l => l.Kind == SupplierLedgerKind.CreditInvoice)
            .GroupBy(l => l.SourceId)
            .Select(g => (Id: g.Key, Date: g.Where(l => !l.IsReversal).Select(l => l.BusinessDate).DefaultIfEmpty(g.First().BusinessDate).Min(),
                Total: g.Sum(l => l.Amount)))
            .Where(i => i.Total > 0)
            .OrderBy(i => i.Date)
            .ToList();
        var open = new List<OpenInvoice>();
        foreach (var (id, date, total) in standing)
        {
            var applied = Math.Min(left, total);
            left -= applied;
            if (applied < total)
                open.Add(new OpenInvoice(
                    id, invoices.GetValueOrDefault(id)?.SupplierInvoiceNumber, date, Money(total), Money(applied), Money(total - applied),
                    applied > 0 ? OpenInvoiceStatus.PartlyPaid : OpenInvoiceStatus.Unpaid));
        }

        return open;
    }

    private static string Describe(SupplierLedgerEntry line, IReadOnlyDictionary<Guid, PurchaseInvoice> invoices)
    {
        var what = line.Kind switch
        {
            SupplierLedgerKind.OpeningBalance => "Owed before the treasury",
            SupplierLedgerKind.CreditInvoice => invoices.GetValueOrDefault(line.SourceId)?.SupplierInvoiceNumber is { } number
                ? $"Invoice {number} on credit"
                : "Invoice on credit",
            _ => "Payment voucher",
        };
        return line.IsReversal ? $"Voided: {what}" : what;
    }

    // ---- Shared ----

    private sealed record Names(
        IReadOnlyDictionary<Guid, string> Suppliers, IReadOnlyDictionary<Guid, string> Expenses, IReadOnlyDictionary<Guid, string?> Invoices,
        IReadOnlyDictionary<Guid, string> Employees);

    private async Task<Names> NamesAsync(IReadOnlyList<SafeTransaction> rows, CancellationToken cancellationToken)
    {
        var invoiceIds = rows.Where(t => t.PurchaseInvoiceId != null).Select(t => t.PurchaseInvoiceId!.Value).Distinct().ToList();
        return new Names(
            await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken),
            await db.ExpenseItems.AsNoTracking().ToDictionaryAsync(e => e.Id, e => e.Name, cancellationToken),
            await db.PurchaseInvoices.AsNoTracking().Where(i => invoiceIds.Contains(i.Id))
                .ToDictionaryAsync(i => i.Id, i => i.SupplierInvoiceNumber, cancellationToken),
            await db.Staff.AsNoTracking().ToDictionaryAsync(e => e.Id, e => e.Name, cancellationToken));
    }

    private static SafeEntryRow Row(SafeTransaction t, Names names, decimal? balance)
    {
        string Supplier() => t.SupplierId is { } id ? names.Suppliers.GetValueOrDefault(id) ?? "a removed supplier" : "no supplier";
        string Takings() => t.RevenueDate is { } day ? $" · from the takings of {day.ToString("d MMM", Invariant)}" : "";
        string Employee() => t.EmployeeId is { } id ? names.Employees.GetValueOrDefault(id) ?? "a removed employee" : "an employee";
        var what = t.Kind switch
        {
            SafeTransactionKind.OpeningBalance => $"Opening balance · {SourceName(t.Source)}",
            SafeTransactionKind.Funding => $"Funding · {SourceName(t.Source)}",
            SafeTransactionKind.RevenueTransfer => $"Takings of {t.RevenueDate!.Value.ToString("d MMM", Invariant)}" +
                (t.PaidOut != 0 ? $" · {Pounds(Math.Abs(t.GrossAmount!.Value))} cash, less {Pounds(Math.Abs(t.PaidOut))} paid out of it" : "") +
                (t.CardAmount != 0 ? $" · {Pounds(Math.Abs(t.CardAmount))} card, to the bank" : ""),
            SafeTransactionKind.ExpenseVoucher => t.ExpenseItemId is { } e ? names.Expenses.GetValueOrDefault(e) ?? "A removed expense" : "An expense",
            SafeTransactionKind.SupplierPayment => $"Payment to {Supplier()}" +
                (t.RevenueDate is { } paidFrom ? $" · from the takings of {paidFrom.ToString("d MMM", Invariant)}" : ""),
            SafeTransactionKind.EmployeeAdvance when t.EmployeeId is null => "Advances, not given out yet" + Takings(),
            SafeTransactionKind.EmployeeAdvance => $"Advance to {Employee()}" + Takings(),
            SafeTransactionKind.SalaryPayment => $"Salary of {Employee()}" + (t.PayrollMonth is { } month ? $" · {month.ToString("MMMM yyyy", Invariant)}" : "") + Takings(),
            _ => (t.PurchaseInvoiceId is { } i && names.Invoices.GetValueOrDefault(i) is { } number ? $"Invoice {number}" : "Invoice") +
                 (t.SupplierId is null ? "" : $" · {Supplier()}") +
                 (t.RevenueDate is { } day ? $" · from the takings of {day.ToString("d MMM", Invariant)}" : ""),
        };
        return new SafeEntryRow(
            t.Id, t.Kind, t.Fund, t.BusinessDate, t.IsReversal ? $"Voided: {what}" : what, t.Amount > 0 ? t.Amount : 0, t.Amount < 0 ? -t.Amount : 0,
            balance is { } b ? Money(b) : null, t.Source, t.RevenueDate, t.SupplierId, t.PurchaseInvoiceId, t.ExpenseItemId, t.Notes, t.RecordedBy,
            t.RecordedAtUtc, t.ApprovedBy, t.ReversalOf, t.VoidedAtUtc, t.VoidedBy, t.IncludesTax, t.TaxPercent, t.TaxAmount, t.GrossAmount,
            t.CardAmount, t.VoidsAmount);
    }

    private static string Pounds(decimal value) => Costing.Application.Common.CompanyMoney.Text(value);

    private static string SourceName(FundingSource? source) => source switch
    {
        FundingSource.CarriedOver => "carried over",
        FundingSource.OwnerFinancing => "owners' financing",
        _ => "other source",
    };

    private static void Period(DateOnly from, DateOnly to)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last.");
        if (to > from.AddYears(2))
            throw new DomainException("Choose two years at most.");
    }
}
