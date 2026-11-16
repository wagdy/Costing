using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// What the restaurant owes its suppliers, by how long it has been owed (أعمار ديون الموردين), and one
// supplier's account over a period (كشف حساب مورد تفصيلي).
//
// Aging: payments are set against what was owed before the treasury first, then the credit invoices
// oldest first (as the open invoices are). Each invoice still owed falls due its supplier's payment
// terms after its date; what was owed before the treasury is due from when it was entered. Days
// past due on the day asked: 0 or less is Current (not due), then 1–30, 31–60, 61–90 and 90+.
public sealed record ApAgingRow(
    Guid SupplierId,
    string Supplier,
    int PaymentTermsDays,
    decimal TotalOwed,
    decimal Current,
    decimal Days1To30,
    decimal Days31To60,
    decimal Days61To90,
    decimal Over90,
    int OpenInvoices,
    DateOnly? OldestDueDate);

public sealed record ApAgingReport(
    DateOnly AsOf,
    decimal TotalOwed,
    decimal Current,
    decimal Days1To30,
    decimal Days31To60,
    decimal Days61To90,
    decimal Over90,
    IReadOnlyList<ApAgingRow> Rows);

public enum SupplierAccountEntryKind
{
    // Owed before the treasury was kept.
    OpeningBalance = 1,
    CreditInvoice = 2,
    // Paid when posted, from the safe or a day's takings: owed and paid at once.
    CashInvoice = 3,
    Payment = 4,
}

// A line of the account: Owed (+, credit) adds to what is owed, Paid (−, debit) takes from it; a
// cash invoice is both. A payment carries its voucher's details, to open it where it is listed.
public sealed record SupplierAccountLine(
    Guid Id,
    DateOnly Date,
    SupplierAccountEntryKind Kind,
    string Reference,
    string Description,
    decimal Paid,
    decimal Owed,
    decimal Balance,
    Guid SourceId,
    bool IsReversal,
    string? RecordedBy = null,
    string? ApprovedBy = null,
    DateOnly? FromTakingsOf = null,
    string? Notes = null);

public sealed record SupplierAccount(
    Guid SupplierId,
    string Supplier,
    int PaymentTermsDays,
    DateOnly From,
    DateOnly To,
    decimal OpeningBalance,
    decimal CreditInvoices,
    decimal CashInvoices,
    decimal Payments,
    decimal ClosingBalance,
    IReadOnlyList<SupplierAccountLine> Lines,
    IReadOnlyList<OpenInvoice> OpenInvoices,
    // What was entered in the period as owed before the treasury was kept: added like an invoice.
    // Closing = opening + owed before + credit invoices − payments.
    decimal OwedBefore = 0);

public sealed class SupplierAccountsService(CostingDbContext db, IBusinessCalendar clock)
{
    public async Task<ApAgingReport> GetAgingAsync(DateOnly? asOf, CancellationToken cancellationToken)
    {
        var day = asOf ?? clock.BusinessDateOf(DateTime.UtcNow);
        var entries = await db.SupplierLedgerEntries.AsNoTracking().Where(l => l.BusinessDate <= day).ToListAsync(cancellationToken);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, cancellationToken);

        var rows = new List<ApAgingRow>();
        foreach (var group in entries.GroupBy(l => l.SupplierId))
        {
            var lines = group.OrderBy(l => l.BusinessDate).ThenBy(l => l.RecordedAtUtc).ToList();
            var (opening, credit, paid) = TreasuryService.Totals(lines);
            var balance = Money(opening + credit - paid);
            if (balance == 0)
                continue;
            var supplier = suppliers.GetValueOrDefault(group.Key);
            var terms = supplier?.PaymentTermsDays ?? 0;

            // What is still owed, each with the day it fell due.
            var owed = new List<(DateOnly Due, decimal Amount)>();
            var openingLeft = Math.Max(opening - paid, 0);
            if (openingLeft > 0)
                owed.Add((lines.Where(l => l.Kind == SupplierLedgerKind.OpeningBalance).Min(l => l.BusinessDate), openingLeft));
            var open = TreasuryService.OpenInvoices(lines, new Dictionary<Guid, PurchaseInvoice>());
            owed.AddRange(open.Select(i => (i.Date.AddDays(terms), i.Remaining)));

            decimal Bucket(int fromDays, int toDays) =>
                Money(owed.Where(o => day.DayNumber - o.Due.DayNumber is var late && late >= fromDays && late <= toDays).Sum(o => o.Amount));
            rows.Add(new ApAgingRow(
                group.Key, supplier?.Name ?? "A removed supplier", terms, balance,
                Bucket(int.MinValue, 0), Bucket(1, 30), Bucket(31, 60), Bucket(61, 90), Bucket(91, int.MaxValue),
                open.Count, owed.Count > 0 ? owed.Min(o => o.Due) : null));
        }

        rows = rows.OrderByDescending(r => r.Over90).ThenByDescending(r => r.TotalOwed).ThenBy(r => r.Supplier, StringComparer.CurrentCultureIgnoreCase).ToList();
        return new ApAgingReport(
            day, Money(rows.Sum(r => r.TotalOwed)), Money(rows.Sum(r => r.Current)), Money(rows.Sum(r => r.Days1To30)), Money(rows.Sum(r => r.Days31To60)),
            Money(rows.Sum(r => r.Days61To90)), Money(rows.Sum(r => r.Over90)), rows);
    }

    // One supplier's account from one day to another: what was owed coming in, every credit and
    // cash invoice and every payment in order with the balance after each, and what is owed going out.
    public async Task<SupplierAccount?> GetAccountAsync(Guid supplierId, DateOnly? from, DateOnly? to, CancellationToken cancellationToken)
    {
        if (await db.Suppliers.AsNoTracking().SingleOrDefaultAsync(s => s.Id == supplierId, cancellationToken) is not { } supplier)
            return null;
        var today = clock.BusinessDateOf(DateTime.UtcNow);
        var last = to ?? today;
        var first = from ?? new DateOnly(last.Year, 1, 1);
        if (last < first)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (last > first.AddYears(5))
            throw new DomainException("Choose five years at most. · خمس سنوات على الأكثر.");

        var ledger = await db.SupplierLedgerEntries.AsNoTracking()
            .Where(l => l.SupplierId == supplierId && l.BusinessDate <= last)
            .OrderBy(l => l.BusinessDate).ThenBy(l => l.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var before = ledger.Where(l => l.BusinessDate < first).ToList();
        var inPeriod = ledger.Where(l => l.BusinessDate >= first).ToList();

        // Cash invoices of the period: paid when posted, so owed and paid at once.
        var (firstUtc, _) = clock.Bounds(first);
        var (_, lastUtc) = clock.Bounds(last);
        var cash = await db.PurchaseInvoices.AsNoTracking().Include(i => i.Lines)
            .Where(i => i.SupplierId == supplierId && i.Status == PurchaseInvoiceStatus.Posted && i.PaymentMethod != PurchasePaymentMethod.Credit
                && ((i.InvoiceDate != null && i.InvoiceDate >= first && i.InvoiceDate <= last)
                    || (i.InvoiceDate == null && i.PostedAtUtc >= firstUtc && i.PostedAtUtc < lastUtc)))
            .ToListAsync(cancellationToken);

        var invoiceIds = inPeriod.Where(l => l.Kind == SupplierLedgerKind.CreditInvoice).Select(l => l.SourceId).Distinct().ToList();
        var invoices = await db.PurchaseInvoices.AsNoTracking().Where(i => invoiceIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, cancellationToken);
        var paymentIds = inPeriod.Where(l => l.Kind == SupplierLedgerKind.Payment).Select(l => l.SourceId).Distinct().ToList();
        var payments = await db.SafeTransactions.AsNoTracking().Where(t => paymentIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, cancellationToken);

        var opening = Money(before.Sum(l => l.Amount));
        var rows = inPeriod
            .Select(l => (Date: l.BusinessDate, At: l.RecordedAtUtc, Line: Line(l, invoices, payments)))
            .Concat(cash.Select(i => (
                Date: i.InvoiceDate ?? clock.BusinessDateOf(i.PostedAtUtc ?? i.CreatedAtUtc), At: i.PostedAtUtc ?? i.CreatedAtUtc,
                Line: new SupplierAccountLine(
                    i.Id, i.InvoiceDate ?? clock.BusinessDateOf(i.PostedAtUtc ?? i.CreatedAtUtc), SupplierAccountEntryKind.CashInvoice,
                    i.SupplierInvoiceNumber is { } n ? $"Invoice {n}" : "Invoice",
                    i.PaymentMethod == PurchasePaymentMethod.DayRevenue ? "Cash invoice, paid from a day's takings · فاتورة نقدي من الإيراد"
                        : i.PaymentMethod == PurchasePaymentMethod.Safe ? "Cash invoice, paid from the safe · فاتورة نقدي من الخزنة"
                        : "Invoice before the treasury · فاتورة قبل الخزنة",
                    i.Total, i.Total, 0, i.Id, false))))
            .OrderBy(r => r.Date).ThenBy(r => r.At)
            .ToList();

        var balance = opening;
        var lines = rows.Select(r =>
        {
            balance += r.Line.Owed - r.Line.Paid;
            return r.Line with { Balance = Money(balance) };
        }).ToList();

        decimal Sum(SupplierLedgerKind kind) => Money(inPeriod.Where(l => l.Kind == kind).Sum(l => l.Amount));
        var open = TreasuryService.OpenInvoices(ledger, await db.PurchaseInvoices.AsNoTracking()
            .Where(i => i.SupplierId == supplierId && i.PaymentMethod == PurchasePaymentMethod.Credit).ToDictionaryAsync(i => i.Id, cancellationToken));
        return new SupplierAccount(
            supplierId, supplier.Name, supplier.PaymentTermsDays, first, last, opening, Sum(SupplierLedgerKind.CreditInvoice),
            Money(cash.Sum(i => i.Total)), -Sum(SupplierLedgerKind.Payment), Money(opening + inPeriod.Sum(l => l.Amount)), lines, open,
            Sum(SupplierLedgerKind.OpeningBalance));
    }

    private static SupplierAccountLine Line(
        SupplierLedgerEntry l, IReadOnlyDictionary<Guid, PurchaseInvoice> invoices, IReadOnlyDictionary<Guid, SafeTransaction> payments)
    {
        var owed = l.Amount > 0 ? l.Amount : 0;
        var paid = l.Amount < 0 ? -l.Amount : 0;
        string Voided(string what) => l.IsReversal ? $"Voided: {what} · ملغى" : what;
        switch (l.Kind)
        {
            case SupplierLedgerKind.OpeningBalance:
                return new SupplierAccountLine(l.Id, l.BusinessDate, SupplierAccountEntryKind.OpeningBalance, "Opening balance",
                    Voided("Owed before the treasury · رصيد سابق"), paid, owed, 0, l.SourceId, l.IsReversal, l.RecordedBy);
            case SupplierLedgerKind.CreditInvoice:
            {
                var number = invoices.GetValueOrDefault(l.SourceId)?.SupplierInvoiceNumber;
                return new SupplierAccountLine(l.Id, l.BusinessDate, SupplierAccountEntryKind.CreditInvoice, number is null ? "Invoice" : $"Invoice {number}",
                    Voided("Invoice on credit · فاتورة آجل"), paid, owed, 0, l.SourceId, l.IsReversal, l.RecordedBy);
            }
            default:
            {
                var voucher = payments.GetValueOrDefault(l.SourceId);
                var from = voucher?.RevenueDate is { } day ? $"from the takings of {day:d MMM} · من إيراد يوم" : "from the safe · من الخزنة";
                return new SupplierAccountLine(l.Id, l.BusinessDate, SupplierAccountEntryKind.Payment, "Payment voucher",
                    Voided($"Payment, {from}"), paid, owed, 0, l.SourceId, l.IsReversal, voucher?.RecordedBy ?? l.RecordedBy, voucher?.ApprovedBy,
                    voucher?.RevenueDate, voucher?.Notes);
            }
        }
    }
}
