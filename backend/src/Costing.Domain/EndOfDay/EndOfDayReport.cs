using System.Globalization;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.Purchases;
using Costing.Domain.Sales;

namespace Costing.Domain.EndOfDay;

public enum EndOfDayStatus
{
    // Being filled in: invoices added, changed or taken off, the sales typed.
    Draft = 1,

    // Handed in (تأكيد وإرسال التقفيل), a closed day: kept as it is, for the daily batch and the
    // takings, until a manager undoes it while it is the last day closed.
    Submitted = 2,
}

// How an invoice handed in at the end of the day was paid.
public enum EndOfDayInvoiceKind
{
    // Paid in cash out of the day's takings (فواتير نقدية).
    Cash = 1,

    // Not paid: owed to the supplier (فواتير آجل).
    Credit = 2,
}

// Cash handed out of the till during the day, its receipt photographed: to a supplier against what
// the restaurant owes them (إذن صرف مورد), or to an employee as an advance on their pay (سلفة).
public enum EndOfDayPayoutKind
{
    SupplierPayment = 1,
    EmployeeAdvance = 2,
}

// A photo or scan handed in, described; its bytes are kept apart (IEndOfDayPhotoStore).
public sealed record EndOfDayPhoto(string FileName, string ContentType, int Bytes)
{
    public static EndOfDayPhoto Of(string? fileName, string contentType, int bytes)
    {
        if (!PurchaseInvoice.AttachmentTypes.Contains(contentType))
            throw new DomainException("Attach a photo (JPEG, PNG or WebP) or a PDF. · أرفق صورة أو ملف PDF.");
        if (bytes is <= 0 or > PurchaseInvoice.MaxAttachmentBytes)
            throw new DomainException("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        var name = string.IsNullOrWhiteSpace(fileName) ? "invoice" : Path.GetFileName(fileName.Trim());
        return new EndOfDayPhoto(name[..Math.Min(name.Length, 200)], contentType.ToLowerInvariant(), bytes);
    }
}

// A day's close (تقفيل اليوم) as the branch hands it in: each invoice paid in cash out of the
// takings, each bought on credit, every one with its paper photographed, its supplier and the total
// written on it; the cash handed out of the till to suppliers and as advances to employees, each
// with its receipt; and the day's Z report, its cash and Visa sales before tax, the tax on them and
// the voids, with a photo of it if there is one, and the float the drawer opened with. The invoices
// become purchase invoices on the daily batch, each transcribed from its photo, and the sales the
// day's takings on Financials; the payments and advances become the safe's entries out of the day's
// takings when it is handed in (Vouchered). One a business day.
//
// The cash that should be in the drawer (NetCashInTill) is the float, and the cash sales with the
// tax collected on them, less every payment out of it: the cash invoices, the suppliers paid and the
// advances. The Visa and any other takings never reach the drawer.
//
// One a business day in each branch (IBranchOwned): with several branches, each closes its own days,
// in its own order, the branch worked in given when it is made.
public sealed class EndOfDayReport : AggregateRoot, IBranchOwned
{
    public const int MaxInvoices = 50;
    public const int MaxNotes = 500;
    // The day's notes and an invoice's or payment's note, room left in each for the system's audit
    // lines (a day moved to another date) on top of what is typed.
    public const int MaxDayNotes = 2000;
    public const int MaxInvoiceNote = 1000;
    public const int MaxPayoutNote = 200;
    public const int MaxPayouts = 50;
    // Why a day is closed with no trade, or moved to another date: required, kept on it.
    public const int MaxAuditReason = 300;

    private readonly List<EndOfDayInvoice> _invoices = [];
    private readonly List<EndOfDayPayout> _payouts = [];
    private readonly List<DiscountReason> _discountReasons = [];

    private EndOfDayReport() { }

    public EndOfDayReport(Guid id, DateOnly date, string createdBy)
    {
        Id = id;
        Date = date;
        Status = EndOfDayStatus.Draft;
        CreatedBy = createdBy;
        CreatedAtUtc = UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = createdBy;
    }

    public DateOnly Date { get; private set; }
    public EndOfDayStatus Status { get; private set; }

    public Guid BranchId { get; private set; }

    public void AssignBranch(Guid branchId) => BranchId = branchId;

    // The Z report: cash and Visa sales before tax, the tax collected on both, voids and refunds.
    public decimal? CashAmount { get; private set; }
    public decimal? CardAmount { get; private set; }
    public decimal? TaxAmount { get; private set; }
    public decimal? VoidsAmount { get; private set; }
    public string? Notes { get; private set; }

    // Discounts and promos (الخصومات والعروض) the Z report gives, and why: taken off the menu prices
    // before the money was collected, so never in the drawer, and nothing in the cash expected below.
    public decimal? DiscountsAmount { get; private set; }
    public IReadOnlyList<DiscountReason> DiscountReasons => _discountReasons.AsReadOnly();

    // The cash the drawer opened the day with (العهدة / الفكة).
    public decimal? OpeningFloat { get; private set; }

    // The Z report's own photo, if one was handed in.
    public string? SalesPhotoFileName { get; private set; }
    public string? SalesPhotoContentType { get; private set; }
    public int? SalesPhotoBytes { get; private set; }
    public EndOfDayPhoto? SalesPhoto => SalesPhotoFileName is null ? null : new(SalesPhotoFileName, SalesPhotoContentType!, SalesPhotoBytes ?? 0);

    public DateTime CreatedAtUtc { get; private set; }
    public string CreatedBy { get; private set; } = string.Empty;
    public DateTime UpdatedAtUtc { get; private set; }
    public string UpdatedBy { get; private set; } = string.Empty;
    public DateTime? SubmittedAtUtc { get; private set; }
    public string? SubmittedBy { get; private set; }
    public DateTime? ReopenedAtUtc { get; private set; }
    public string? ReopenedBy { get; private set; }

    // Why a manager undid it (إلغاء تقفيل اليوم), to be handed in again.
    public string? ReopenReason { get; private set; }

    // A day the restaurant did not trade (يوم مغلق أو صيانة): handed in with nothing on it, for the
    // days to stay in order, and why.
    public bool IsClosedDay { get; private set; }
    public string? ClosedDayReason { get; private set; }

    // What the system did to the day, a line each, never changed: a day closed with no trade, a draft
    // moved to another date (سجل التدقيق).
    public string? AuditTrail { get; private set; }

    public IReadOnlyList<EndOfDayInvoice> Invoices => _invoices.OrderBy(i => i.AddedAtUtc).ToList().AsReadOnly();

    public IReadOnlyList<EndOfDayPayout> Payouts => _payouts.OrderBy(p => p.AddedAtUtc).ToList().AsReadOnly();

    public bool IsSubmitted => Status == EndOfDayStatus.Submitted;

    // Anything handed in for the day: an invoice, a payment, a figure of its sales report or its photo.
    public bool HasEntries =>
        _invoices.Count > 0 || _payouts.Count > 0 || SalesPhotoFileName is not null
        || new[] { CashAmount, CardAmount, TaxAmount, VoidsAmount, OpeningFloat, DiscountsAmount }.Any(n => n is > 0);

    public decimal TotalOf(EndOfDayInvoiceKind kind) => _invoices.Where(i => i.Kind == kind).Sum(i => i.ReportedTotal);

    public int CountOf(EndOfDayInvoiceKind kind) => _invoices.Count(i => i.Kind == kind);

    public decimal TotalOf(EndOfDayPayoutKind kind) => _payouts.Where(p => p.Kind == kind).Sum(p => p.Amount);

    public int CountOf(EndOfDayPayoutKind kind) => _payouts.Count(p => p.Kind == kind);

    // Cash and Visa before tax: the day's revenue.
    public decimal NetSales => (CashAmount ?? 0) + (CardAmount ?? 0);

    // All the Z report took in, the tax with it: what goes into the safe before anything paid out.
    public decimal TotalRevenue => NetSales + (TaxAmount ?? 0);

    // The day's cash once the cash invoices were paid out of it.
    public decimal CashAfterInvoices => (CashAmount ?? 0) - TotalOf(EndOfDayInvoiceKind.Cash);

    // The tax collected on the cash sales: the Z report gives the tax on the cash and Visa together,
    // the cash's share of it is in proportion, as the safe splits a day's tax.
    public decimal CashTax => NetSales > 0 ? Math.Round((TaxAmount ?? 0) * (CashAmount ?? 0) / NetSales, 2, MidpointRounding.AwayFromZero) : 0;

    // The cash the sales put in the drawer: the cash sales with the tax collected on them.
    public decimal CashSalesCollected => (CashAmount ?? 0) + CashTax;

    // Everything paid out of the drawer: the cash invoices, the suppliers paid, the advances.
    public decimal CashPaidOut => TotalOf(EndOfDayInvoiceKind.Cash) + TotalOf(EndOfDayPayoutKind.SupplierPayment) + TotalOf(EndOfDayPayoutKind.EmployeeAdvance);

    // The cash that should be in the drawer at the close (الصافي الفعلي المتبقي في الكاش): the float
    // and the cash sales, less what was paid out of it. The Visa never reaches the drawer, and the
    // discounts never do: they were never collected (the cash is after them).
    public decimal NetCashInTill => (OpeningFloat ?? 0) + CashSalesCollected - CashPaidOut;

    // What should reach the safe: everything the day took in, less all that was paid out of it, as
    // the takings will show once the invoices are posted and the payments entered from them.
    public decimal ExpectedIntoSafe => TotalRevenue - CashPaidOut;

    public EndOfDayInvoice Invoice(Guid invoiceId) =>
        _invoices.SingleOrDefault(i => i.Id == invoiceId) ?? throw new NotFoundException("End-of-day invoice", invoiceId);

    public void RecordSales(
        decimal? cash, decimal? card, decimal? tax, decimal? voids, string? notes, string by, decimal? openingFloat = null,
        decimal? discounts = null, IReadOnlyList<DiscountReason>? discountReasons = null)
    {
        EnsureDraft();
        var reasons = Discounts.Clean(discounts ?? 0, discountReasons);
        if (new[] { cash, card, tax, voids }.Any(n => n < 0))
            throw new DomainException("The cash, Visa, tax and voids are zero or more. · المبالغ صفر أو أكثر.");
        if (openingFloat < 0)
            throw new DomainException("The opening float is zero or more. · العهدة صفر أو أكثر.");
        var cleaned = Clean(notes);
        if (cleaned?.Length > MaxDayNotes)
            throw new DomainException("Keep the notes under 2,000 characters. · الملاحظات 2000 حرف على الأكثر.");
        CashAmount = Money(cash);
        CardAmount = Money(card);
        TaxAmount = Money(tax);
        VoidsAmount = Money(voids);
        DiscountsAmount = Money(discounts);
        _discountReasons.Clear();
        _discountReasons.AddRange(reasons);
        OpeningFloat = Money(openingFloat);
        Notes = cleaned;
        Touch(by);
    }

    public EndOfDayInvoice AddInvoice(
        Guid id, EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note, EndOfDayPhoto photo, string by, Guid? purchaseOrderId = null)
    {
        EnsureDraft();
        if (_invoices.Any(i => i.Id == id))
            throw new DomainException("This invoice is handed in already.");
        if (_invoices.Count >= MaxInvoices)
            throw new DomainException($"A day holds at most {MaxInvoices} invoices. · {MaxInvoices} فاتورة على الأكثر في اليوم.");
        var invoice = new EndOfDayInvoice(id, Id, kind, supplierId, reportedTotal, note, photo, purchaseOrderId);
        _invoices.Add(invoice);
        Touch(by);
        return invoice;
    }

    public void ChangeInvoice(
        Guid invoiceId, EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note, string by, Guid? purchaseOrderId = null)
    {
        EnsureDraft();
        Unposted(invoiceId).Change(kind, supplierId, reportedTotal, note, purchaseOrderId);
        Touch(by);
    }

    public void ReplaceInvoicePhoto(Guid invoiceId, EndOfDayPhoto photo, string by)
    {
        EnsureDraft();
        Unposted(invoiceId).Photographed(photo);
        Touch(by);
    }

    public void RemoveInvoice(Guid invoiceId, string by)
    {
        EnsureDraft();
        _invoices.Remove(Unposted(invoiceId));
        Touch(by);
    }

    public EndOfDayPayout Payout(Guid payoutId) =>
        _payouts.SingleOrDefault(p => p.Id == payoutId) ?? throw new NotFoundException("End-of-day payment", payoutId);

    // Cash handed out of the till: to a supplier (payee: the supplier) or an employee (payee: the
    // employee), with its receipt.
    public EndOfDayPayout AddPayout(Guid id, EndOfDayPayoutKind kind, Guid payeeId, decimal amount, string? note, EndOfDayPhoto receipt, string by)
    {
        EnsureDraft();
        if (_payouts.Any(p => p.Id == id))
            throw new DomainException("This payment is handed in already.");
        if (_payouts.Count >= MaxPayouts)
            throw new DomainException($"A day holds at most {MaxPayouts} payments and advances. · {MaxPayouts} على الأكثر في اليوم.");
        var payout = new EndOfDayPayout(id, Id, kind, payeeId, amount, note, receipt);
        _payouts.Add(payout);
        Touch(by);
        return payout;
    }

    public void ChangePayout(Guid payoutId, Guid payeeId, decimal amount, string? note, string by)
    {
        EnsureDraft();
        Unvouchered(payoutId).Change(payeeId, amount, note);
        Touch(by);
    }

    // A clearer photo of its receipt: the money is as it was, so even once in the safe.
    public void ReplacePayoutReceipt(Guid payoutId, EndOfDayPhoto receipt, string by)
    {
        EnsureDraft();
        Payout(payoutId).Photographed(receipt);
        Touch(by);
    }

    // Taken off. One whose safe entry a manager refused can go too: nothing was entered for it.
    public void RemovePayout(Guid payoutId, string by, bool voucherRefused = false)
    {
        EnsureDraft();
        _payouts.Remove(voucherRefused ? Payout(payoutId) : Unvouchered(payoutId));
        Touch(by);
    }

    // Its safe entry made, or asked of a manager, once the day is handed in: kept as it is from then,
    // and corrected on the safe.
    public void Vouchered(Guid payoutId)
    {
        if (!IsSubmitted)
            throw new DomainException("The end of day is not submitted yet: its payments go to the safe once it is handed in.");
        Payout(payoutId).VoucheredOn();
    }

    public void AttachSalesPhoto(EndOfDayPhoto photo, string by)
    {
        EnsureDraft();
        (SalesPhotoFileName, SalesPhotoContentType, SalesPhotoBytes) = (photo.FileName, photo.ContentType, photo.Bytes);
        Touch(by);
    }

    public void RemoveSalesPhoto(string by)
    {
        EnsureDraft();
        (SalesPhotoFileName, SalesPhotoContentType, SalesPhotoBytes) = (null, null, null);
        Touch(by);
    }

    // Handed in: kept as it is from now. It needs the day's sales, unless it is closed as a day that
    // sold nothing (zeroSales: the restaurant shut), to keep the days in order; a day with no invoice
    // is one nothing was bought on.
    public void Submit(string by, bool zeroSales = false)
    {
        EnsureDraft();
        if (NetSales <= 0 && !zeroSales)
            throw new DomainException(
                "Enter the day's sales report: its cash or Visa takings, or close it as a day with no sales. · أدخل ريبورت المبيعات، أو أقفل اليوم بدون مبيعات.");
        if ((TaxAmount ?? 0) > NetSales)
            throw new DomainException("The tax collected cannot be more than the day's sales. · الضريبة لا تزيد عن إجمالي المبيعات.");
        Status = EndOfDayStatus.Submitted;
        SubmittedAtUtc = DateTime.UtcNow;
        SubmittedBy = by;
        Touch(by);
    }

    // A manager's undo (إلغاء تقفيل اليوم): back to a draft, to be corrected and handed in again. The
    // caller reverses what it put in the books (its payments' safe entries, the purchase invoices
    // posted from its invoices, its takings and its sales); here its payments are not in the safe any
    // more and its invoices not posted, so handing it in again does both afresh.
    public void Undo(string by, string? reason = null)
    {
        if (!IsSubmitted)
            throw new DomainException("This end of day is not submitted: it can be changed as it is. · التقفيل لم يُرسل بعد.");
        var why = Clean(reason);
        if (why?.Length > MaxNotes)
            throw new DomainException($"Keep the reason under {MaxNotes} characters.");
        foreach (var payout in _payouts)
            payout.Unvouchered();
        foreach (var invoice in _invoices)
            invoice.Unposted();
        if (IsClosedDay)
            Audit($"Closed day undone by {by}{(why is null ? "" : $": {why}")}");
        (IsClosedDay, ClosedDayReason) = (false, null);
        Status = EndOfDayStatus.Draft;
        ReopenedAtUtc = DateTime.UtcNow;
        ReopenedBy = by;
        ReopenReason = why;
        Touch(by);
    }

    // A day the restaurant did not trade (تسجيل يوم إغلاق أو صيانة), closed with nothing on it so the
    // days stay in order: why is required. Never a day with anything handed in: that is handed in as
    // it is.
    public void MarkClosed(string by, string? reason)
    {
        EnsureDraft();
        var why = Reason(reason, "Say why the restaurant was closed that day: it is kept on the day. · اذكر سبب الإغلاق.");
        if (HasEntries)
            throw new DomainException(
                $"{Day(Date)} has entries handed in: hand it in with them, or take them off before closing it as a day with no trade. · لهذا اليوم بيانات مسجلة.");
        IsClosedDay = true;
        ClosedDayReason = why;
        Audit($"Marked as a closed day by {by}: {why}");
        Status = EndOfDayStatus.Submitted;
        SubmittedAtUtc = DateTime.UtcNow;
        SubmittedBy = by;
        Touch(by);
    }

    // A draft entered under the wrong date, moved to the one it belongs to (ترحيل المسودة العالقة),
    // everything on it with it: why is required, and the move is written into its notes, each
    // invoice's note and its audit trail. The caller checks the date is the one to close next.
    public void MoveTo(DateOnly date, string by, string? reason)
    {
        EnsureDraft();
        var why = Reason(reason, "Give the reason for moving the day to another date: it is kept on it. · سبب التعديل إجباري.");
        if (date == Date)
            throw new DomainException($"It is dated {Day(date)} already. · التاريخ نفسه.");
        var line = $"System Audit: Migrated from {Date.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)} to "
            + $"{date.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)} by {by} due to: {why}";
        var notes = Notes is null ? line : $"{Notes}\n{line}";
        if (notes.Length > MaxDayNotes)
            throw new DomainException("The day's notes are too long to take the audit line: shorten them first. · اختصر ملاحظات اليوم أولاً.");
        foreach (var invoice in _invoices)
            invoice.Audited(line);
        Notes = notes;
        Audit(line);
        Date = date;
        Touch(by);
    }

    private static string Reason(string? reason, string missing)
    {
        var why = Clean(reason) ?? throw new DomainException(missing);
        return why.Length > MaxAuditReason
            ? throw new DomainException($"Keep the reason under {MaxAuditReason} characters. · السبب {MaxAuditReason} حرف على الأكثر.")
            : why;
    }

    private void Audit(string line)
    {
        var stamped = $"{DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)} UTC · {line}";
        AuditTrail = AuditTrail is null ? stamped : $"{AuditTrail}\n{stamped}";
    }

    private static string Day(DateOnly day) => day.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture);

    // An invoice handed in, posted on the daily batch as the purchase invoice given.
    public void Posted(Guid invoiceId, Guid purchaseInvoiceId)
    {
        if (!IsSubmitted)
            throw new DomainException("Its end of day is not submitted yet: it is posted once it is handed in. · لم يتم إرسال تقفيل هذا اليوم بعد.");
        var invoice = Invoice(invoiceId);
        if (invoice.PurchaseInvoiceId is { } posted && posted != purchaseInvoiceId)
            throw new DomainException("It is posted already, as another purchase invoice. · مرحلة بالفعل في فاتورة أخرى.");
        invoice.PostedAs(purchaseInvoiceId);
    }

    private EndOfDayPayout Unvouchered(Guid payoutId)
    {
        var payout = Payout(payoutId);
        if (payout.VoucheredAtUtc is not null)
            throw new DomainException("It went to the safe when the day was handed in: correct it on Financials → Safe. · مسجل في الخزنة: عدّله من الخزنة.");
        return payout;
    }

    private EndOfDayInvoice Unposted(Guid invoiceId)
    {
        var invoice = Invoice(invoiceId);
        if (invoice.PurchaseInvoiceId is not null)
            throw new DomainException("It is posted already as a purchase invoice: correct that invoice instead. · مرحلة بالفعل: عدّل فاتورة الشراء.");
        return invoice;
    }

    private void EnsureDraft()
    {
        if (IsSubmitted)
            throw new DomainException(
                $"The end of day of {Date.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} is submitted{(SubmittedBy is null ? "" : $" by {SubmittedBy}")}: to change it, a manager undoes it while it is the last day closed (Reports → Daily summaries). " +
                "· تم إرسال تقفيل هذا اليوم: يلغيه المدير ويفتحه للتعديل ما دام آخر يوم تم إغلاقه.");
    }

    private void Touch(string by)
    {
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    private static decimal? Money(decimal? value) => value is { } v ? Math.Round(v, 2, MidpointRounding.AwayFromZero) : null;

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

// One invoice handed in: how it was paid, who from, the total written on it, a short note, and its
// photo; once on the daily batch, the purchase invoice it was posted as.
public sealed class EndOfDayInvoice : Entity
{
    private EndOfDayInvoice() { }

    internal EndOfDayInvoice(
        Guid id, Guid reportId, EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note, EndOfDayPhoto photo, Guid? purchaseOrderId = null)
    {
        Id = id;
        ReportId = reportId;
        AddedAtUtc = DateTime.UtcNow;
        Change(kind, supplierId, reportedTotal, note, purchaseOrderId);
        Photographed(photo);
    }

    public Guid ReportId { get; private set; }
    public EndOfDayInvoiceKind Kind { get; private set; }
    public Guid SupplierId { get; private set; }
    public decimal ReportedTotal { get; private set; }
    public string? Note { get; private set; }
    public string PhotoFileName { get; private set; } = string.Empty;
    public string PhotoContentType { get; private set; } = string.Empty;
    public int PhotoBytes { get; private set; }
    public EndOfDayPhoto Photo => new(PhotoFileName, PhotoContentType, PhotoBytes);
    public DateTime AddedAtUtc { get; private set; }

    // The purchase order it delivers, when it was ordered (أمر شراء): the daily batch receives it against it.
    public Guid? PurchaseOrderId { get; private set; }

    // The purchase invoice it was posted as on the daily batch, and when.
    public Guid? PurchaseInvoiceId { get; private set; }
    public DateTime? PostedAtUtc { get; private set; }

    internal void Change(EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note, Guid? purchaseOrderId = null)
    {
        if (!Enum.IsDefined(kind))
            throw new DomainException("Say whether it was paid in cash or is on credit. · نقدي أم آجل.");
        if (supplierId == Guid.Empty)
            throw new DomainException("Choose the supplier. · اختر المورد.");
        if (reportedTotal <= 0)
            throw new DomainException("Enter the invoice's total, more than nothing. · أدخل إجمالي الفاتورة.");
        var cleaned = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (cleaned?.Length > EndOfDayReport.MaxInvoiceNote)
            throw new DomainException("Keep the note under 1,000 characters. · الملاحظة 1000 حرف على الأكثر.");
        Kind = kind;
        SupplierId = supplierId;
        ReportedTotal = Math.Round(reportedTotal, 2, MidpointRounding.AwayFromZero);
        Note = cleaned;
        PurchaseOrderId = purchaseOrderId;
    }

    internal void Photographed(EndOfDayPhoto photo) =>
        (PhotoFileName, PhotoContentType, PhotoBytes) = (photo.FileName, photo.ContentType, photo.Bytes);

    // Its day moved to another date: the system's audit line under its note.
    internal void Audited(string line)
    {
        var note = Note is null ? line : $"{Note}\n{line}";
        Note = note.Length <= EndOfDayReport.MaxInvoiceNote
            ? note
            : throw new DomainException("An invoice's note is too long to take the audit line: shorten it first. · اختصر ملاحظة الفاتورة أولاً.");
    }

    // Its day undone: its purchase invoice voided, to be posted again.
    internal void Unposted()
    {
        PurchaseInvoiceId = null;
        PostedAtUtc = null;
    }

    internal void PostedAs(Guid purchaseInvoiceId)
    {
        PurchaseInvoiceId = purchaseInvoiceId;
        PostedAtUtc ??= DateTime.UtcNow;
    }
}

// Cash handed out of the till: to a supplier or an employee, the amount, a short note and its
// receipt (إيصال السداد / إيصال صرف السلفة); once the day is handed in, when its safe entry was made
// (or asked of a manager), the entry's id being the payment's own.
public sealed class EndOfDayPayout : Entity
{
    private EndOfDayPayout() { }

    internal EndOfDayPayout(Guid id, Guid reportId, EndOfDayPayoutKind kind, Guid payeeId, decimal amount, string? note, EndOfDayPhoto receipt)
    {
        if (!Enum.IsDefined(kind))
            throw new DomainException("Say whether a supplier was paid or an employee advanced. · مورد أم سلفة.");
        Id = id;
        VoucherId = id;
        ReportId = reportId;
        Kind = kind;
        AddedAtUtc = DateTime.UtcNow;
        Change(payeeId, amount, note);
        Photographed(receipt);
    }

    public Guid ReportId { get; private set; }

    // The id of the safe entry (or the request to a manager) it is made when its day is handed in:
    // its own to begin with, a new one each time its day is undone, as the voided entry keeps the old.
    public Guid VoucherId { get; private set; }
    public EndOfDayPayoutKind Kind { get; private set; }
    public Guid? SupplierId { get; private set; }
    public Guid? EmployeeId { get; private set; }
    public decimal Amount { get; private set; }
    public string? Note { get; private set; }
    public string ReceiptFileName { get; private set; } = string.Empty;
    public string ReceiptContentType { get; private set; } = string.Empty;
    public int ReceiptBytes { get; private set; }
    public EndOfDayPhoto Receipt => new(ReceiptFileName, ReceiptContentType, ReceiptBytes);
    public DateTime AddedAtUtc { get; private set; }

    // When its safe entry was made or asked for: the day handed in.
    public DateTime? VoucheredAtUtc { get; private set; }

    // Who was paid: the supplier, or the employee.
    public Guid PayeeId => (Kind == EndOfDayPayoutKind.SupplierPayment ? SupplierId : EmployeeId) ?? Guid.Empty;

    internal void Change(Guid payeeId, decimal amount, string? note)
    {
        if (payeeId == Guid.Empty)
            throw new DomainException(Kind == EndOfDayPayoutKind.SupplierPayment ? "Choose the supplier. · اختر المورد." : "Choose the employee. · اختر الموظف.");
        if (amount <= 0)
            throw new DomainException("Enter the amount paid, more than nothing. · أدخل المبلغ المدفوع.");
        var cleaned = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (cleaned?.Length > EndOfDayReport.MaxPayoutNote)
            throw new DomainException("Keep the note under 200 characters. · الملاحظة 200 حرف على الأكثر.");
        var toSupplier = Kind == EndOfDayPayoutKind.SupplierPayment;
        SupplierId = toSupplier ? payeeId : null;
        EmployeeId = toSupplier ? null : payeeId;
        Amount = Math.Round(amount, 2, MidpointRounding.AwayFromZero);
        Note = cleaned;
    }

    internal void Photographed(EndOfDayPhoto receipt) =>
        (ReceiptFileName, ReceiptContentType, ReceiptBytes) = (receipt.FileName, receipt.ContentType, receipt.Bytes);

    internal void VoucheredOn() => VoucheredAtUtc ??= DateTime.UtcNow;

    // Its day undone: its safe entry voided, to be made again when the day is handed in.
    internal void Unvouchered()
    {
        VoucheredAtUtc = null;
        VoucherId = Guid.NewGuid();
    }
}

// Returns each day with its Invoices and Payouts loaded; a day by its date is the branch worked in's.
public interface IEndOfDayRepository : IRepository<EndOfDayReport>
{
    Task<EndOfDayReport?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default);

    // Drafts dated after a day (stranded past the one to close next), earliest first.
    Task<IReadOnlyList<EndOfDayReport>> GetDraftsAfterAsync(DateOnly date, CancellationToken cancellationToken = default);

    // A draft with nothing on it, taken away to make room for one moved onto its date.
    void Remove(EndOfDayReport report);

    // The last day handed in (آخر يوم تم تقفيله), if any: the sequence goes on from it.
    Task<DateOnly?> LastSubmittedDateAsync(CancellationToken cancellationToken = default);

    // The day every branch in use that closes its days has closed up to: the earliest of their last
    // days handed in (the one branch's last, while there is one). The books are locked up to it at
    // the latest.
    Task<DateOnly?> LastClosedEverywhereAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<EndOfDayReport>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    // The day an invoice was handed in on.
    Task<EndOfDayReport?> GetByInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default);

    // The day a payment or advance was handed in on.
    Task<EndOfDayReport?> GetByPayoutAsync(Guid payoutId, CancellationToken cancellationToken = default);
}

// The photos handed in, kept apart from the days so a list of them never loads a megabyte each:
// an invoice's or a payment's receipt by its id, the Z report's by its day's. Written in the same
// unit of work.
public interface IEndOfDayPhotoStore
{
    void Put(Guid id, byte[] content);

    Task<byte[]?> GetAsync(Guid id, CancellationToken cancellationToken = default);

    void Remove(Guid id);
}

// Days are closed in exact order (التسلسل الزمني الإلزامي): the moving average costs and the profit
// and loss follow the days as they go, so a day closed on the wrong date breaks both. Once any day
// is closed, the next is the day after the last one closed, and only that one; never a day still to
// come; never one in the books locked by a manager. The first day ever closed starts the sequence.
public static class EndOfDaySequence
{
    public static DateOnly? NextAfter(DateOnly? lastClosed) => lastClosed?.AddDays(1);

    public static void Check(DateOnly date, DateOnly? lastClosed, DateOnly today, DateOnly? lockedUntil)
    {
        if (date > today)
            throw new DomainException("That day has not come yet: close a day once it is over. · هذا اليوم لم يأتِ بعد.");
        if (lockedUntil is { } locked && date <= locked)
            throw new PeriodLockedException(locked, date);
        if (lastClosed is not { } last)
            return;
        var next = last.AddDays(1);
        if (date == next)
            return;
        throw new DomainException(date <= last
            ? $"{Day(date)} is closed already, or before the last closed day ({Day(last)}): days are closed in exact order, the next is {Day(next)}. " +
              $"· آخر يوم تم إغلاقه هو {Day(last)}، واليوم التالي هو {Day(next)}."
            : $"Close {Day(next)} first: days are closed in exact order, the last closed was {Day(last)}. " +
              $"· يجب إغلاق يوم {Day(next)} أولاً، آخر يوم تم إغلاقه هو {Day(last)}.");
    }

    private static string Day(DateOnly day) => day.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture);
}
