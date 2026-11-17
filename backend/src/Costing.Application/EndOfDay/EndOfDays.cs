using System.Globalization;
using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Sales;
using Costing.Domain.Staff;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;

namespace Costing.Application.EndOfDay;

// The end of the day (تقفيل اليوم) as a branch hands it in: the day's invoices photographed, each
// paid in cash out of the takings or bought on credit, with its supplier and the total on it; the
// cash paid out of the till to suppliers and as advances to employees, each with its receipt; and
// the day's sales report with the float the drawer opened with. Filled in as a draft, an entry at a
// time so a phone sends one photo at a time; submitted, it is kept as it is for the daily batch,
// where each invoice is transcribed from its photo, and for the day's takings, and each payment and
// advance becomes the safe's entry out of the day's takings (a manager's at once, anyone else's
// asked of a manager), under the payment's voucher id. Days are closed in exact order, one after the
// last closed day and never ahead of today; a manager undoes the last closed day, and only it, to
// correct it: what it made voided and the day a draft again (Strict sequentiality and the manager's
// undo, in the docs). The day is made by its first entry; an entry's id is made by the till, so one sent again is not added twice.
//
// An advance is deducted from the employee's pay in the payroll month it is paid in, as every
// advance out of the safe is.

public sealed record EndOfDayPhotoDto(string FileName, string ContentType, int Bytes)
{
    public static EndOfDayPhotoDto? From(EndOfDayPhoto? photo) => photo is null ? null : new(photo.FileName, photo.ContentType, photo.Bytes);
}

public sealed record EndOfDayInvoiceDto(
    Guid Id,
    EndOfDayInvoiceKind Kind,
    Guid SupplierId,
    string Supplier,
    decimal ReportedTotal,
    string? Note,
    EndOfDayPhotoDto Photo,
    DateTime AddedAtUtc,
    // The purchase invoice it was posted as on the daily batch.
    Guid? PurchaseInvoiceId,
    DateTime? PostedAtUtc,
    // The purchase order it delivers, when there was one: the batch receives it against it.
    Guid? PurchaseOrderId = null);

// Where a payment's safe entry is: none yet (the day not handed in), asked of a manager, in the
// safe, or refused by a manager (it can then be taken off, and entered again).
public enum EndOfDayVoucherState
{
    None = 1,
    Requested = 2,
    InSafe = 3,
    Refused = 4,
}

public sealed record EndOfDayPayoutDto(
    Guid Id,
    EndOfDayPayoutKind Kind,
    Guid? SupplierId,
    Guid? EmployeeId,
    // The supplier's or the employee's name.
    string Payee,
    decimal Amount,
    string? Note,
    EndOfDayPhotoDto Receipt,
    DateTime AddedAtUtc,
    EndOfDayVoucherState Voucher,
    DateTime? VoucheredAtUtc);

public sealed record EndOfDayDto(
    Guid Id,
    DateOnly Date,
    EndOfDayStatus Status,
    decimal? CashAmount,
    decimal? CardAmount,
    decimal? TaxAmount,
    decimal? VoidsAmount,
    string? Notes,
    EndOfDayPhotoDto? SalesPhoto,
    IReadOnlyList<EndOfDayInvoiceDto> Invoices,
    int CashInvoices,
    decimal CashInvoicesTotal,
    int CreditInvoices,
    decimal CreditInvoicesTotal,
    // Cash and Visa before tax; with the tax; the cash once the cash invoices were paid out of it;
    // and what should reach the safe, everything less the cash invoices.
    decimal NetSales,
    decimal TotalRevenue,
    decimal CashAfterInvoices,
    decimal ExpectedIntoSafe,
    // How many of its invoices are posted on the daily batch.
    int Posted,
    // The day's takings as entered on Financials, if they are.
    decimal? TakingsEntered,
    string CreatedBy,
    DateTime CreatedAtUtc,
    string UpdatedBy,
    DateTime UpdatedAtUtc,
    string? SubmittedBy,
    DateTime? SubmittedAtUtc,
    string? ReopenedBy,
    DateTime? ReopenedAtUtc,
    // The float the drawer opened with; the cash paid out to suppliers and as advances.
    decimal? OpeningFloat,
    IReadOnlyList<EndOfDayPayoutDto> Payouts,
    int SupplierPayments,
    decimal SupplierPaymentsTotal,
    int Advances,
    decimal AdvancesTotal,
    // The tax on the cash sales (their share of the day's tax), the cash the sales put in the drawer
    // with it, all that was paid out of the drawer, and what should be left in it: the float and the
    // cash sales, less the cash invoices, the suppliers paid and the advances.
    decimal CashTax,
    decimal CashSalesCollected,
    decimal CashPaidOut,
    decimal NetCashInTill,
    // The discounts and promos the Z report gives, and why: never collected, never in the till.
    decimal? DiscountsAmount = null,
    IReadOnlyList<DiscountReason>? DiscountReasons = null,
    // Why a manager undid it, when one did.
    string? ReopenReason = null,
    // As it was handed in: what to look at before the next day (EndOfDayChecks), never refusing it.
    IReadOnlyList<string>? Warnings = null);

// The days in their order (التسلسل الزمني): the last one closed and the one to close next (none
// before the first is ever closed: any day up to today starts the sequence), today as the till
// keeps it, whether every day up to today is closed, the books' lock, what to look at before
// closing the next (Warnings), and what undoing the last one would reverse (LastClosed).
public sealed record EndOfDaySequenceDto(
    DateOnly? LastClosedDate,
    DateOnly? NextExpectedDate,
    DateOnly Today,
    bool AllClosed,
    DateOnly? BooksLockedUntil,
    IReadOnlyList<string> Warnings,
    EndOfDayUndoPreview? LastClosed);

// What undoing the last closed day reverses: its takings in the safe, its sales summary (by hand
// or from the POS), the purchase invoices posted from the invoices handed in, and its payments'
// safe entries (and requests waiting for a manager). Locked: the books are closed over it.
public sealed record EndOfDayUndoPreview(
    DateOnly Date,
    string? SubmittedBy,
    DateTime? SubmittedAtUtc,
    decimal? Takings,
    int SalesItems,
    int PostedInvoices,
    decimal PostedInvoicesTotal,
    int Payouts,
    decimal PayoutsTotal,
    bool Locked,
    int ZReports = 0);

// Undone: the day back to a draft, and what was reversed to get there (ZReports: the POS's reports
// of the day, each recorded again when the POS sends it again).
public sealed record EndOfDayUndone(
    EndOfDayDto Day, bool TakingsVoided, bool SalesVoided, int InvoicesVoided, int PayoutsVoided, int RequestsRefused, int ZReports = 0);

// The date the books are locked until (إقفال الدفاتر), set on Financials → Tax & service: no day on
// or before it is closed or undone.
public interface IBooksLock
{
    Task<DateOnly?> LockedUntilAsync(CancellationToken cancellationToken);
}

public sealed record EndOfDayPhotoFile(string FileName, string ContentType, byte[] Content);

public sealed record GetEndOfDayQuery(DateOnly Date) : IRequest<EndOfDayDto?>;

// The days handed in over a period, latest first, without their photos.
public sealed record GetEndOfDaysQuery(DateOnly From, DateOnly To) : IRequest<IReadOnlyList<EndOfDayDto>>;

public sealed record SaveEndOfDaySalesCommand(
    DateOnly Date, decimal? CashAmount, decimal? CardAmount, decimal? TaxAmount, decimal? VoidsAmount, string? Notes, string StaffName = "",
    decimal? OpeningFloat = null, decimal? DiscountsAmount = null, IReadOnlyList<DiscountReason>? DiscountReasons = null)
    : IRequest<EndOfDayDto>;

public sealed record AddEndOfDayInvoiceCommand(
    DateOnly Date,
    Guid InvoiceId,
    EndOfDayInvoiceKind Kind,
    Guid SupplierId,
    decimal ReportedTotal,
    string? Note,
    string FileName,
    string ContentType,
    byte[] Content,
    string StaffName = "",
    Guid? PurchaseOrderId = null) : IRequest<EndOfDayDto>;

public sealed record ChangeEndOfDayInvoiceCommand(
    DateOnly Date, Guid InvoiceId, EndOfDayInvoiceKind Kind, Guid SupplierId, decimal ReportedTotal, string? Note, string StaffName = "",
    Guid? PurchaseOrderId = null)
    : IRequest<EndOfDayDto>;

public sealed record ReplaceEndOfDayInvoicePhotoCommand(DateOnly Date, Guid InvoiceId, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record RemoveEndOfDayInvoiceCommand(DateOnly Date, Guid InvoiceId, string StaffName = "") : IRequest<EndOfDayDto>;

public sealed record AttachEndOfDaySalesPhotoCommand(DateOnly Date, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record RemoveEndOfDaySalesPhotoCommand(DateOnly Date, string StaffName = "") : IRequest<EndOfDayDto>;

// Handed in: its payments and advances made the safe's entries (CanApprove, a manager), or asked of
// a manager (StaffId, who asks). Only the next day in the sequence; with no sales, only once
// confirmed as a day that sold nothing (ZeroSales) and when nothing was sold on it.
public sealed record SubmitEndOfDayCommand(DateOnly Date, string StaffName = "", string StaffId = "", bool CanApprove = false, bool ZeroSales = false)
    : IRequest<EndOfDayDto>, IRetryOnConflict;

public sealed record GetEndOfDaySequenceQuery : IRequest<EndOfDaySequenceDto>;

// A manager's: the last day closed, undone and back to a draft (Date: the one the manager saw, so
// a day closed since is never undone by mistake).
public sealed record UndoLastEndOfDayCommand(DateOnly? Date, string? Reason, string StaffName = "", string StaffId = "")
    : IRequest<EndOfDayUndone>, IRetryOnConflict;

// Cash paid out of the till: PayeeId the supplier paid or the employee advanced; PayoutId made by the
// till, so one sent again is not added twice.
public sealed record AddEndOfDayPayoutCommand(
    DateOnly Date,
    Guid PayoutId,
    EndOfDayPayoutKind Kind,
    Guid PayeeId,
    decimal Amount,
    string? Note,
    string FileName,
    string ContentType,
    byte[] Content,
    string StaffName = "") : IRequest<EndOfDayDto>;

public sealed record ChangeEndOfDayPayoutCommand(DateOnly Date, Guid PayoutId, Guid PayeeId, decimal Amount, string? Note, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record ReplaceEndOfDayPayoutReceiptCommand(DateOnly Date, Guid PayoutId, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record RemoveEndOfDayPayoutCommand(DateOnly Date, Guid PayoutId, string StaffName = "") : IRequest<EndOfDayDto>;


// A photo of the day: an invoice's or a payment's receipt by its id, the sales report's by the day's.
public sealed record GetEndOfDayPhotoQuery(DateOnly Date, Guid PhotoId) : IRequest<EndOfDayPhotoFile?>;

// What the use cases share: the day, made by its first entry; the photo checked; the day as shown.
internal sealed class EndOfDayDays(
    IEndOfDayRepository days,
    IEndOfDayPhotoStore photos,
    ISupplierRepository suppliers,
    ISafeTransactionRepository safe,
    IBusinessCalendar calendar,
    ISupplierLedgerRepository ledger,
    IStaffMemberRepository employees,
    IApprovalRequestRepository requests,
    TreasuryWriter treasury,
    IBooksLock books,
    Costing.Domain.Purchases.IPurchaseInvoiceRepository invoices)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // Cash handed out with no one named, older than this, is said before a day is closed.
    public static readonly TimeSpan CustodyAge = TimeSpan.FromHours(48);

    public IEndOfDayPhotoStore Photos => photos;

    // Today as the till keeps it: between midnight and the hour the business day starts, the
    // calendar's day is taken too, never one later.
    public DateOnly Today
    {
        get
        {
            var now = DateTime.UtcNow;
            return new[] { calendar.BusinessDateOf(now), calendar.LocalDateOf(now) }.Max();
        }
    }

    // A new day only for the next in the sequence: entries for any other date would make a day that
    // can never be handed in.
    public async Task<EndOfDayReport> OpenAsync(DateOnly date, string by, CancellationToken cancellationToken)
    {
        if (await days.GetByDateAsync(date, cancellationToken) is { } day)
            return day;
        await CheckSequenceAsync(date, cancellationToken);
        days.Add(day = new EndOfDayReport(Guid.NewGuid(), date, by));
        return day;
    }

    public async Task CheckSequenceAsync(DateOnly date, CancellationToken cancellationToken) =>
        EndOfDaySequence.Check(date, await days.LastSubmittedDateAsync(cancellationToken), Today, await books.LockedUntilAsync(cancellationToken));

    // What to look at before closing a day, never refusing it: purchase invoices left as drafts
    // dated on or before it (post them first, or the stock and costs are short), and cash handed out
    // with no one named (a custody, سلفة معلقة) more than 48 hours ago in the last 30 days, which
    // should have been given out to the staff on HR → Advances or voided.
    public async Task<IReadOnlyList<string>> WarningsAsync(DateOnly date, CancellationToken cancellationToken)
    {
        var warnings = new List<string>();
        var names = (await suppliers.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        var drafts = (await invoices.GetByStatusAsync(Costing.Domain.Purchases.PurchaseInvoiceStatus.Draft, cancellationToken))
            .Where(i => i.InvoiceDate is { } on && on <= date && i.Lines.Count > 0)
            .OrderBy(i => i.InvoiceDate)
            .ToList();
        if (drafts.Count > 0)
            warnings.Add(
                $"There are draft invoices: {drafts.Count} draft purchase {(drafts.Count == 1 ? "invoice is" : "invoices are")} dated on or before {Day(date)} " +
                $"({string.Join(", ", drafts.Take(3).Select(i => (i.SupplierId is { } s ? names.GetValueOrDefault(s) : null) ?? "no supplier"))}" +
                $"{(drafts.Count > 3 ? ", …" : "")}). Consider posting them before closing the day. · توجد فواتير مسودة: يفضل ترحيلها قبل تقفيل اليوم.");
        var cutoff = DateTime.UtcNow - CustodyAge;
        var custodies = (await safe.GetPendingAdvancesAsync(cancellationToken))
            .Where(a => !a.IsReversal && !a.IsVoided && a.RecordedAtUtc < cutoff && a.BusinessDate >= date.AddDays(-30))
            .ToList();
        if (custodies.Count > 0)
            warnings.Add(
                $"{custodies.Count} cash {(custodies.Count == 1 ? "custody" : "custodies")} handed out with no one named more than 48 hours ago, " +
                $"{CompanyMoney.Text(-custodies.Sum(a => a.Amount))} in all (the oldest {Day(custodies.Min(a => a.BusinessDate))}): " +
                "settle them by giving them out on HR → Advances, or void them. · عُهد نقدية لم تُسوَّ منذ أكثر من 48 ساعة.");
        return warnings;
    }

    private static string Day(DateOnly day) => day.ToString("d MMM yyyy", Invariant);

    public async Task<EndOfDayReport> GetAsync(DateOnly date, CancellationToken cancellationToken) =>
        await days.GetByDateAsync(date, cancellationToken)
            ?? throw new NotFoundException("End of day", date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));

    // A supplier on the list: not one archived since, for a new or changed invoice.
    public async Task CheckSupplierAsync(Guid supplierId, CancellationToken cancellationToken)
    {
        var supplier = await suppliers.GetByIdAsync(supplierId, cancellationToken)
            ?? throw new DomainException("Choose the supplier from the list. · اختر المورد من القائمة.");
        if (supplier.IsArchived)
            throw new DomainException($"{supplier.Name} is archived: choose another supplier. · المورد مؤرشف.");
    }

    // Who a payment goes to, and how much it can be: a supplier on the list, paid no more than they
    // are owed less what the day's other payments to them, not in the safe yet, take off; an
    // employee on the staff, not one who has left.
    public async Task CheckPayeeAsync(EndOfDayReport day, EndOfDayPayoutKind kind, Guid payeeId, decimal amount, Guid payoutId, CancellationToken cancellationToken)
    {
        if (kind == EndOfDayPayoutKind.EmployeeAdvance)
        {
            var employee = await employees.GetByIdAsync(payeeId, cancellationToken)
                ?? throw new DomainException("Choose the employee from the list. · اختر الموظف من القائمة.");
            if (!employee.IsActive)
                throw new DomainException($"{employee.Name} has left: bring them back on Financials → Staff first. · الموظف غير نشط.");
            return;
        }

        await CheckSupplierAsync(payeeId, cancellationToken);
        var supplier = (await suppliers.GetByIdAsync(payeeId, cancellationToken))!;
        var others = await PendingToAsync(day, payeeId, payoutId, cancellationToken);
        var owed = await ledger.BalanceAsync(payeeId, cancellationToken) - others;
        if (Math.Round(amount, 2, MidpointRounding.AwayFromZero) > owed)
            throw new DomainException(owed > 0
                ? $"{supplier.Name} is owed {CompanyMoney.Text(owed)}{(others > 0 ? " after the day's other payments to them" : "")}: pay that much or less. · المبلغ أكبر من المستحق للمورد."
                : $"Nothing is owed to {supplier.Name}{(others > 0 ? " after the day's other payments to them" : "")}. · لا يوجد مستحق للمورد.");
    }

    // The day's payments to a supplier not in the safe yet: on the supplier's account only once they are.
    private async Task<decimal> PendingToAsync(EndOfDayReport day, Guid supplierId, Guid except, CancellationToken cancellationToken)
    {
        var pending = 0m;
        foreach (var payout in day.Payouts.Where(p => p.Kind == EndOfDayPayoutKind.SupplierPayment && p.SupplierId == supplierId && p.Id != except))
            if (await VoucherStateAsync(payout, cancellationToken) is EndOfDayVoucherState.None or EndOfDayVoucherState.Requested)
                pending += payout.Amount;
        return pending;
    }

    public async Task<EndOfDayVoucherState> VoucherStateAsync(EndOfDayPayout payout, CancellationToken cancellationToken)
    {
        if (payout.VoucheredAtUtc is null)
            return EndOfDayVoucherState.None;
        if (await safe.GetByIdAsync(payout.VoucherId, cancellationToken) is not null)
            return EndOfDayVoucherState.InSafe;
        return (await requests.GetByIdAsync(payout.VoucherId, cancellationToken))?.Status switch
        {
            ApprovalStatus.Rejected => EndOfDayVoucherState.Refused,
            ApprovalStatus.Pending => EndOfDayVoucherState.Requested,
            // Approved, entered: the entry is the safe's.
            _ => EndOfDayVoucherState.InSafe,
        };
    }

    // The day handed in: each payment and advance not in the safe yet made the safe's entry out of
    // the day's takings, dated the day, its id the payment's (a manager's), or asked of a manager
    // (anyone else's). All of them or none: one that cannot be refuses the day, naming it.
    public async Task VoucherPayoutsAsync(EndOfDayReport day, string staffId, string staffName, bool canApprove, CancellationToken cancellationToken)
    {
        var problems = new List<string>();
        // What each supplier is still owed as the day's payments to them are entered.
        var owedLeft = new Dictionary<Guid, decimal>();
        var names = (await suppliers.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        var staff = (await employees.GetAllAsync(cancellationToken)).ToDictionary(e => e.Id, e => e.Name);
        foreach (var payout in day.Payouts.Where(p => p.VoucheredAtUtc is null))
        {
            var toSupplier = payout.Kind == EndOfDayPayoutKind.SupplierPayment;
            var name = (toSupplier ? names.GetValueOrDefault(payout.PayeeId) : staff.GetValueOrDefault(payout.PayeeId)) ?? (toSupplier ? "a supplier" : "an employee");
            try
            {
                // Sent again after an answer was lost: entered, or asked, already.
                if (await safe.GetByIdAsync(payout.VoucherId, cancellationToken) is not null || await requests.GetByIdAsync(payout.VoucherId, cancellationToken) is not null)
                {
                    day.Vouchered(payout.Id);
                    continue;
                }

                if (toSupplier)
                {
                    var owed = owedLeft.TryGetValue(payout.PayeeId, out var left)
                        ? left
                        : await ledger.BalanceAsync(payout.PayeeId, cancellationToken) - await RequestedToAsync(day, payout.PayeeId, cancellationToken);
                    if (payout.Amount > owed)
                        throw new DomainException(owed > 0 ? $"{name} is owed {CompanyMoney.Text(owed)}: pay that much or less." : $"Nothing is owed to {name}.");
                    owedLeft[payout.PayeeId] = owed - payout.Amount;
                }

                var voucher = new SafeVoucher(
                    payout.VoucherId, toSupplier ? SafeTransactionKind.SupplierPayment : SafeTransactionKind.EmployeeAdvance, payout.Amount, day.Date,
                    RevenueDate: day.Date, SupplierId: toSupplier ? payout.PayeeId : null, EmployeeId: toSupplier ? null : payout.PayeeId,
                    Notes: payout.Note is { } note ? $"End of day: {note}" : "End of day · تقفيل اليوم");
                if (canApprove)
                {
                    await treasury.ApplyAsync(voucher, staffName, null, cancellationToken);
                }
                else
                {
                    await treasury.CheckAsync(voucher, cancellationToken);
                    var (summary, changes) = await treasury.DescribeAsync(voucher, cancellationToken);
                    requests.Add(ApprovalRequest.AskToChange(
                        payout.VoucherId, ApprovalModule.Treasury, ApprovalAction.Create, payout.VoucherId, summary, changes, ApprovalPayload.Write(voucher),
                        $"End of day of {day.Date.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}", staffId, staffName));
                }
                day.Vouchered(payout.Id);
            }
            catch (Exception error) when (error is DomainException or NotFoundException)
            {
                problems.Add($"{(toSupplier ? "Supplier payment" : "Advance")} · {name}: {error.Message}");
            }
        }
        if (problems.Count > 0)
            throw new DomainException(string.Join("\n", problems));
    }

    // The day's payments to a supplier asked of a manager and not decided yet: not on the supplier's
    // account, but promised out of what is owed.
    private async Task<decimal> RequestedToAsync(EndOfDayReport day, Guid supplierId, CancellationToken cancellationToken)
    {
        var requested = 0m;
        foreach (var payout in day.Payouts.Where(p => p.Kind == EndOfDayPayoutKind.SupplierPayment && p.SupplierId == supplierId && p.VoucheredAtUtc is not null))
            if (await VoucherStateAsync(payout, cancellationToken) == EndOfDayVoucherState.Requested)
                requested += payout.Amount;
        return requested;
    }

    public static EndOfDayPhoto Photo(string fileName, string contentType, byte[] content)
    {
        var photo = EndOfDayPhoto.Of(fileName, contentType, content.Length);
        if (!UploadedFile.LooksLike(contentType, content))
            throw new DomainException("That file is not the photo or PDF it says it is. · الملف ليس صورة أو PDF.");
        return photo;
    }

    public async Task<EndOfDayDto> DtoAsync(EndOfDayReport day, CancellationToken cancellationToken) =>
        (await DtosAsync([day], cancellationToken)).Single();

    public async Task<IReadOnlyList<EndOfDayDto>> DtosAsync(IReadOnlyList<EndOfDayReport> list, CancellationToken cancellationToken)
    {
        var names = (await suppliers.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        var staff = (await employees.GetAllAsync(cancellationToken)).ToDictionary(e => e.Id, e => e.Name);
        var dtos = new List<EndOfDayDto>();
        foreach (var day in list)
        {
            var takings = await safe.GetTakingsAsync(day.Date, cancellationToken);
            var payouts = new List<EndOfDayPayoutDto>();
            foreach (var p in day.Payouts)
            {
                var payee = p.Kind == EndOfDayPayoutKind.SupplierPayment
                    ? names.GetValueOrDefault(p.PayeeId, "A removed supplier")
                    : staff.GetValueOrDefault(p.PayeeId, "A removed employee");
                payouts.Add(new EndOfDayPayoutDto(
                    p.Id, p.Kind, p.SupplierId, p.EmployeeId, payee, p.Amount, p.Note, EndOfDayPhotoDto.From(p.Receipt)!, p.AddedAtUtc,
                    await VoucherStateAsync(p, cancellationToken), p.VoucheredAtUtc));
            }
            dtos.Add(new EndOfDayDto(
                day.Id, day.Date, day.Status, day.CashAmount, day.CardAmount, day.TaxAmount, day.VoidsAmount, day.Notes,
                EndOfDayPhotoDto.From(day.SalesPhoto),
                day.Invoices.Select(i => new EndOfDayInvoiceDto(
                    i.Id, i.Kind, i.SupplierId, names.GetValueOrDefault(i.SupplierId, "A removed supplier"), i.ReportedTotal, i.Note,
                    EndOfDayPhotoDto.From(i.Photo)!, i.AddedAtUtc, i.PurchaseInvoiceId, i.PostedAtUtc, i.PurchaseOrderId)).ToList(),
                day.CountOf(EndOfDayInvoiceKind.Cash), day.TotalOf(EndOfDayInvoiceKind.Cash),
                day.CountOf(EndOfDayInvoiceKind.Credit), day.TotalOf(EndOfDayInvoiceKind.Credit),
                day.NetSales, day.TotalRevenue, day.CashAfterInvoices, day.ExpectedIntoSafe,
                day.Invoices.Count(i => i.PurchaseInvoiceId is not null), takings?.TakingsTotal,
                day.CreatedBy, day.CreatedAtUtc, day.UpdatedBy, day.UpdatedAtUtc, day.SubmittedBy, day.SubmittedAtUtc, day.ReopenedBy, day.ReopenedAtUtc,
                day.OpeningFloat, payouts,
                day.CountOf(EndOfDayPayoutKind.SupplierPayment), day.TotalOf(EndOfDayPayoutKind.SupplierPayment),
                day.CountOf(EndOfDayPayoutKind.EmployeeAdvance), day.TotalOf(EndOfDayPayoutKind.EmployeeAdvance),
                day.CashTax, day.CashSalesCollected, day.CashPaidOut, day.NetCashInTill, day.DiscountsAmount, day.DiscountReasons.ToList(),
                day.ReopenReason));
        }
        return dtos;
    }
}

internal sealed class GetEndOfDayQueryHandler(IEndOfDayRepository days, EndOfDayDays shared) : IRequestHandler<GetEndOfDayQuery, EndOfDayDto?>
{
    public async Task<EndOfDayDto?> Handle(GetEndOfDayQuery request, CancellationToken cancellationToken) =>
        await days.GetByDateAsync(request.Date, cancellationToken) is { } day ? await shared.DtoAsync(day, cancellationToken) : null;
}

internal sealed class GetEndOfDaysQueryHandler(IEndOfDayRepository days, EndOfDayDays shared) : IRequestHandler<GetEndOfDaysQuery, IReadOnlyList<EndOfDayDto>>
{
    public async Task<IReadOnlyList<EndOfDayDto>> Handle(GetEndOfDaysQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (request.To.DayNumber - request.From.DayNumber > 92)
            throw new DomainException("Choose three months at most. · ثلاثة أشهر على الأكثر.");
        var list = (await days.GetBetweenAsync(request.From, request.To, cancellationToken)).OrderByDescending(d => d.Date).ToList();
        return await shared.DtosAsync(list, cancellationToken);
    }
}

internal sealed class SaveEndOfDaySalesCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<SaveEndOfDaySalesCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(SaveEndOfDaySalesCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        day.RecordSales(
            request.CashAmount, request.CardAmount, request.TaxAmount, request.VoidsAmount, request.Notes, request.StaffName, request.OpeningFloat,
            request.DiscountsAmount, request.DiscountReasons);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class AddEndOfDayInvoiceCommandHandler(EndOfDayDays shared, IEndOfDayRepository days, IUnitOfWork unitOfWork)
    : IRequestHandler<AddEndOfDayInvoiceCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(AddEndOfDayInvoiceCommand request, CancellationToken cancellationToken)
    {
        // Sent again after an answer was lost: added already.
        if (await days.GetByInvoiceAsync(request.InvoiceId, cancellationToken) is { } added)
            return added.Date == request.Date
                ? await shared.DtoAsync(added, cancellationToken)
                : throw new DomainException("This invoice is handed in on another day. · الفاتورة مسجلة في يوم آخر.");

        var photo = EndOfDayDays.Photo(request.FileName, request.ContentType, request.Content);
        await shared.CheckSupplierAsync(request.SupplierId, cancellationToken);
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        day.AddInvoice(request.InvoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, photo, request.StaffName, request.PurchaseOrderId);
        shared.Photos.Put(request.InvoiceId, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class ChangeEndOfDayInvoiceCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<ChangeEndOfDayInvoiceCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(ChangeEndOfDayInvoiceCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        if (day.Invoice(request.InvoiceId).SupplierId != request.SupplierId)
            await shared.CheckSupplierAsync(request.SupplierId, cancellationToken);
        day.ChangeInvoice(request.InvoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, request.StaffName, request.PurchaseOrderId);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class ReplaceEndOfDayInvoicePhotoCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork)
    : IRequestHandler<ReplaceEndOfDayInvoicePhotoCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(ReplaceEndOfDayInvoicePhotoCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        day.ReplaceInvoicePhoto(request.InvoiceId, EndOfDayDays.Photo(request.FileName, request.ContentType, request.Content), request.StaffName);
        shared.Photos.Put(request.InvoiceId, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class RemoveEndOfDayInvoiceCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<RemoveEndOfDayInvoiceCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(RemoveEndOfDayInvoiceCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        day.RemoveInvoice(request.InvoiceId, request.StaffName);
        shared.Photos.Remove(request.InvoiceId);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class AttachEndOfDaySalesPhotoCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork)
    : IRequestHandler<AttachEndOfDaySalesPhotoCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(AttachEndOfDaySalesPhotoCommand request, CancellationToken cancellationToken)
    {
        var photo = EndOfDayDays.Photo(request.FileName, request.ContentType, request.Content);
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        day.AttachSalesPhoto(photo, request.StaffName);
        shared.Photos.Put(day.Id, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class RemoveEndOfDaySalesPhotoCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork)
    : IRequestHandler<RemoveEndOfDaySalesPhotoCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(RemoveEndOfDaySalesPhotoCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        day.RemoveSalesPhoto(request.StaffName);
        shared.Photos.Remove(day.Id);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class SubmitEndOfDayCommandHandler(
    EndOfDayDays shared, ISalesReceiptRepository sales, ISafeTransactionRepository safe, IUnitOfWork unitOfWork)
    : IRequestHandler<SubmitEndOfDayCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(SubmitEndOfDayCommand request, CancellationToken cancellationToken)
    {
        // A day that sold nothing may have nothing handed in at all: made here to be closed.
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        // Sent again after an answer was lost: submitted already.
        if (day.IsSubmitted)
            return await shared.DtoAsync(day, cancellationToken);

        // Only the next day in the sequence, never one to come or in the books locked.
        await shared.CheckSequenceAsync(day.Date, cancellationToken);
        if (day.NetSales <= 0 && request.ZeroSales)
        {
            // Closed as a day that sold nothing only when nothing was: neither a sales summary nor takings.
            if (await sales.GetDailySummaryAsync(day.Date, cancellationToken) is { } summary)
                throw new DomainException(
                    $"The day's sales summary has {summary.Lines.Count} items sold on it: enter the day's sales report instead of closing it with none. " +
                    "· توجد مبيعات مسجلة لهذا اليوم: أدخل ريبورت المبيعات.");
            if (await safe.GetTakingsAsync(day.Date, cancellationToken) is not null)
                throw new DomainException("The day's takings are in the safe: enter the day's sales report instead of closing it with none. · توجد إيرادات مسجلة لهذا اليوم.");
        }
        var warnings = await shared.WarningsAsync(day.Date, cancellationToken);
        day.Submit(request.StaffName, request.ZeroSales);
        await shared.VoucherPayoutsAsync(day, request.StaffId, request.StaffName, request.CanApprove, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken) with { Warnings = warnings };
    }
}

internal sealed class GetEndOfDaySequenceHandler(
    EndOfDayDays shared, IEndOfDayRepository days, IBooksLock books, ISafeTransactionRepository safe, ISalesReceiptRepository sales,
    Costing.Domain.Integrations.IPosZReportRepository zReports)
    : IRequestHandler<GetEndOfDaySequenceQuery, EndOfDaySequenceDto>
{
    public async Task<EndOfDaySequenceDto> Handle(GetEndOfDaySequenceQuery request, CancellationToken cancellationToken)
    {
        var last = await days.LastSubmittedDateAsync(cancellationToken);
        var next = EndOfDaySequence.NextAfter(last);
        var today = shared.Today;
        var locked = await books.LockedUntilAsync(cancellationToken);
        EndOfDayUndoPreview? preview = null;
        if (last is { } lastDate && await days.GetByDateAsync(lastDate, cancellationToken) is { } day)
        {
            var summary = await sales.GetDailySummaryAsync(lastDate, cancellationToken);
            var vouchered = day.Payouts.Where(p => p.VoucheredAtUtc is not null).ToList();
            preview = new EndOfDayUndoPreview(
                lastDate, day.SubmittedBy, day.SubmittedAtUtc, (await safe.GetTakingsAsync(lastDate, cancellationToken))?.TakingsTotal,
                summary?.Lines.Count ?? 0, day.Invoices.Count(i => i.PurchaseInvoiceId is not null),
                day.Invoices.Where(i => i.PurchaseInvoiceId is not null).Sum(i => i.ReportedTotal), vouchered.Count, vouchered.Sum(p => p.Amount),
                locked is { } l && lastDate <= l, (await zReports.GetByDateAsync(lastDate, cancellationToken)).Count);
        }
        var closing = next ?? today;
        return new EndOfDaySequenceDto(
            last, next, today, next > today, locked, next > today ? [] : await shared.WarningsAsync(closing, cancellationToken), preview);
    }
}

// The last closed day undone (إلغاء تقفيل آخر يوم), a manager's: everything it put in the books
// reversed, dated today, so it is handed in again as it should have been. Its takings voided in the
// safe; its sales summary (entered by hand, or made by the POS's Z report: sent again, it is made
// again) voided, its stock put back; the purchase invoices posted from the invoices handed in
// voided (their stock, costs, cash and supplier's account undone) and unlinked, to be posted again;
// its payments' safe entries voided and those still waiting for a manager refused. Only the last
// day, so the days before it stay as they were; never one in the books locked.
internal sealed class UndoLastEndOfDayHandler(
    EndOfDayDays shared,
    IEndOfDayRepository days,
    IBooksLock books,
    ISafeTransactionRepository safe,
    ISalesReceiptRepository sales,
    Costing.Domain.Purchases.IPurchaseInvoiceRepository invoices,
    IApprovalRequestRepository requests,
    Costing.Domain.StockMovements.IStockMovementRepository movements,
    DeletionTargets deletions,
    TreasuryWriter treasury,
    Costing.Domain.Integrations.IPosZReportRepository zReports,
    Costing.Domain.Integrations.IPosDayRepository posDays,
    IUnitOfWork unitOfWork) : IRequestHandler<UndoLastEndOfDayCommand, EndOfDayUndone>
{
    public async Task<EndOfDayUndone> Handle(UndoLastEndOfDayCommand request, CancellationToken cancellationToken)
    {
        var last = await days.LastSubmittedDateAsync(cancellationToken)
            ?? throw new DomainException("No day is closed: there is nothing to undo. · لا يوجد يوم مُقفل.");
        if (request.Date is { } asked && asked != last)
            throw new DomainException(
                $"Only the last closed day, {last.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}, is undone: the days before it stay as they are. " +
                "· يُلغى تقفيل آخر يوم فقط.");
        if (await books.LockedUntilAsync(cancellationToken) is { } locked && last <= locked)
            throw new DomainException(
                $"The books are locked until {locked.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}: that day is not undone. · الدفاتر مقفلة.");
        var day = await shared.GetAsync(last, cancellationToken);
        var by = request.StaffName;

        // Its takings in the safe, and its sales summary with the stock it took. What was paid out of
        // the day's takings before they went in goes back to the day's drawer, not the safe: the
        // takings leave the safe less it.
        var takings = await safe.GetTakingsAsync(last, cancellationToken);
        bool? inSafe = takings is null ? null : false;
        if (takings is not null)
        {
            await requests.EnsureNotPendingAsync(takings.Id, cancellationToken);
            await treasury.VoidAsync(takings, by, cancellationToken);
        }
        var summary = await sales.GetDailySummaryAsync(last, cancellationToken);
        if (summary is not null)
        {
            await requests.EnsureNotPendingAsync(summary.Id, cancellationToken);
            foreach (var reversal in await deletions.DeleteAsync(Costing.Domain.Approvals.ApprovalModule.Sale, summary.Id, by, cancellationToken))
                movements.Add(reversal);
        }

        // The POS's mapping of the day: nothing of it recorded now, and each of its Z reports taken
        // again when the POS sends it again (the same report is not a resend any more).
        var reports = await zReports.GetByDateAsync(last, cancellationToken);
        foreach (var report in reports)
            report.Forgotten();
        (await posDays.GetByDateAsync(last, cancellationToken))?.Undone();

        // The purchase invoices posted from its invoices: the one standing now, a correction's if
        // one was corrected since, voided.
        var invoicesVoided = 0;
        foreach (var handedIn in day.Invoices.Where(i => i.PurchaseInvoiceId is not null))
        {
            var invoice = await invoices.GetByIdAsync(handedIn.PurchaseInvoiceId!.Value, cancellationToken);
            while (invoice is { Status: Costing.Domain.Purchases.PurchaseInvoiceStatus.Voided, ReplacedBy: { } next })
                invoice = await invoices.GetByIdAsync(next, cancellationToken);
            if (invoice is not { Status: Costing.Domain.Purchases.PurchaseInvoiceStatus.Posted })
                continue;
            await requests.EnsureNotPendingAsync(invoice.Id, cancellationToken);
            foreach (var reversal in await deletions.VoidInvoiceAsync(invoice, by, null, cancellationToken, inSafe))
                movements.Add(reversal);
            invoicesVoided++;
        }

        // Its payments: those in the safe voided, those waiting for a manager refused.
        var (payoutsVoided, refused) = (0, 0);
        foreach (var payout in day.Payouts.Where(p => p.VoucheredAtUtc is not null))
        {
            if (await safe.GetByIdAsync(payout.VoucherId, cancellationToken) is { IsVoided: false, IsReversal: false } entry)
            {
                await treasury.VoidAsync(entry, by, cancellationToken, inSafe);
                payoutsVoided++;
            }
            else if (await requests.GetByIdAsync(payout.VoucherId, cancellationToken) is { IsPending: true } waiting)
            {
                waiting.Reject(by, "The end of day was undone · أُلغي تقفيل اليوم");
                refused++;
            }
        }

        day.Undo(by, request.Reason);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new EndOfDayUndone(
            await shared.DtoAsync(day, cancellationToken), takings is not null, summary is not null, invoicesVoided, payoutsVoided, refused, reports.Count);
    }
}

internal sealed class AddEndOfDayPayoutCommandHandler(EndOfDayDays shared, IEndOfDayRepository days, IUnitOfWork unitOfWork)
    : IRequestHandler<AddEndOfDayPayoutCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(AddEndOfDayPayoutCommand request, CancellationToken cancellationToken)
    {
        // Sent again after an answer was lost: added already.
        if (await days.GetByPayoutAsync(request.PayoutId, cancellationToken) is { } added)
            return added.Date == request.Date
                ? await shared.DtoAsync(added, cancellationToken)
                : throw new DomainException("This payment is handed in on another day. · مسجل في يوم آخر.");

        var receipt = EndOfDayDays.Photo(request.FileName, request.ContentType, request.Content);
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        await shared.CheckPayeeAsync(day, request.Kind, request.PayeeId, request.Amount, request.PayoutId, cancellationToken);
        day.AddPayout(request.PayoutId, request.Kind, request.PayeeId, request.Amount, request.Note, receipt, request.StaffName);
        shared.Photos.Put(request.PayoutId, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class ChangeEndOfDayPayoutCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<ChangeEndOfDayPayoutCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(ChangeEndOfDayPayoutCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        var payout = day.Payout(request.PayoutId);
        await shared.CheckPayeeAsync(day, payout.Kind, request.PayeeId, request.Amount, payout.Id, cancellationToken);
        day.ChangePayout(request.PayoutId, request.PayeeId, request.Amount, request.Note, request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class ReplaceEndOfDayPayoutReceiptCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork)
    : IRequestHandler<ReplaceEndOfDayPayoutReceiptCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(ReplaceEndOfDayPayoutReceiptCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        day.ReplacePayoutReceipt(request.PayoutId, EndOfDayDays.Photo(request.FileName, request.ContentType, request.Content), request.StaffName);
        shared.Photos.Put(request.PayoutId, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class RemoveEndOfDayPayoutCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<RemoveEndOfDayPayoutCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(RemoveEndOfDayPayoutCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        var refused = await shared.VoucherStateAsync(day.Payout(request.PayoutId), cancellationToken) == EndOfDayVoucherState.Refused;
        day.RemovePayout(request.PayoutId, request.StaffName, refused);
        shared.Photos.Remove(request.PayoutId);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}


internal sealed class GetEndOfDayPhotoQueryHandler(IEndOfDayRepository days, IEndOfDayPhotoStore photos)
    : IRequestHandler<GetEndOfDayPhotoQuery, EndOfDayPhotoFile?>
{
    public async Task<EndOfDayPhotoFile?> Handle(GetEndOfDayPhotoQuery request, CancellationToken cancellationToken)
    {
        if (await days.GetByDateAsync(request.Date, cancellationToken) is not { } day)
            return null;
        var photo = request.PhotoId == day.Id
            ? day.SalesPhoto
            : day.Invoices.FirstOrDefault(i => i.Id == request.PhotoId)?.Photo ?? day.Payouts.FirstOrDefault(p => p.Id == request.PhotoId)?.Receipt;
        return photo is not null && await photos.GetAsync(request.PhotoId, cancellationToken) is { } content
            ? new EndOfDayPhotoFile(photo.FileName, photo.ContentType, content)
            : null;
    }
}
