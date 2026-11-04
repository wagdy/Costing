using System.Globalization;
using Costing.Domain.Common;
using Costing.Domain.Purchases;

namespace Costing.Domain.EndOfDay;

public enum EndOfDayStatus
{
    // Being filled in: invoices added, changed or taken off, the sales typed.
    Draft = 1,

    // Handed in (تأكيد وإرسال التقفيل): kept as it is, for the daily batch and the takings, until a
    // manager reopens it.
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
// written on it; and the day's Z report, its cash and Visa sales before tax, the tax on them and the
// voids, with a photo of it if there is one. Nothing is posted by it: the invoices become purchase
// invoices on the daily batch, each transcribed from its photo, and the sales the day's takings on
// Financials. One a business day.
public sealed class EndOfDayReport : AggregateRoot
{
    public const int MaxInvoices = 50;
    public const int MaxNotes = 500;
    public const int MaxInvoiceNote = 200;

    private readonly List<EndOfDayInvoice> _invoices = [];

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

    // The Z report: cash and Visa sales before tax, the tax collected on both, voids and refunds.
    public decimal? CashAmount { get; private set; }
    public decimal? CardAmount { get; private set; }
    public decimal? TaxAmount { get; private set; }
    public decimal? VoidsAmount { get; private set; }
    public string? Notes { get; private set; }

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

    public IReadOnlyList<EndOfDayInvoice> Invoices => _invoices.OrderBy(i => i.AddedAtUtc).ToList().AsReadOnly();

    public bool IsSubmitted => Status == EndOfDayStatus.Submitted;

    public decimal TotalOf(EndOfDayInvoiceKind kind) => _invoices.Where(i => i.Kind == kind).Sum(i => i.ReportedTotal);

    public int CountOf(EndOfDayInvoiceKind kind) => _invoices.Count(i => i.Kind == kind);

    // Cash and Visa before tax: the day's revenue.
    public decimal NetSales => (CashAmount ?? 0) + (CardAmount ?? 0);

    // All the Z report took in, the tax with it: what goes into the safe before anything paid out.
    public decimal TotalRevenue => NetSales + (TaxAmount ?? 0);

    // The day's cash once the cash invoices were paid out of it.
    public decimal CashAfterInvoices => (CashAmount ?? 0) - TotalOf(EndOfDayInvoiceKind.Cash);

    // What should reach the safe: everything the day took in, less the cash invoices paid out of it,
    // as the takings will show once the invoices are posted from them.
    public decimal ExpectedIntoSafe => TotalRevenue - TotalOf(EndOfDayInvoiceKind.Cash);

    public EndOfDayInvoice Invoice(Guid invoiceId) =>
        _invoices.SingleOrDefault(i => i.Id == invoiceId) ?? throw new NotFoundException("End-of-day invoice", invoiceId);

    public void RecordSales(decimal? cash, decimal? card, decimal? tax, decimal? voids, string? notes, string by)
    {
        EnsureDraft();
        if (new[] { cash, card, tax, voids }.Any(n => n < 0))
            throw new DomainException("The cash, Visa, tax and voids are zero or more. · المبالغ صفر أو أكثر.");
        var cleaned = Clean(notes);
        if (cleaned?.Length > MaxNotes)
            throw new DomainException("Keep the notes under 500 characters. · الملاحظات 500 حرف على الأكثر.");
        CashAmount = Money(cash);
        CardAmount = Money(card);
        TaxAmount = Money(tax);
        VoidsAmount = Money(voids);
        Notes = cleaned;
        Touch(by);
    }

    public EndOfDayInvoice AddInvoice(Guid id, EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note, EndOfDayPhoto photo, string by)
    {
        EnsureDraft();
        if (_invoices.Any(i => i.Id == id))
            throw new DomainException("This invoice is handed in already.");
        if (_invoices.Count >= MaxInvoices)
            throw new DomainException($"A day holds at most {MaxInvoices} invoices. · {MaxInvoices} فاتورة على الأكثر في اليوم.");
        var invoice = new EndOfDayInvoice(id, Id, kind, supplierId, reportedTotal, note, photo);
        _invoices.Add(invoice);
        Touch(by);
        return invoice;
    }

    public void ChangeInvoice(Guid invoiceId, EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note, string by)
    {
        EnsureDraft();
        Unposted(invoiceId).Change(kind, supplierId, reportedTotal, note);
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

    // Handed in: kept as it is from now. It needs the day's sales; a day with no invoice is one
    // nothing was bought on.
    public void Submit(string by)
    {
        EnsureDraft();
        if (NetSales <= 0)
            throw new DomainException("Enter the day's sales report: its cash or Visa takings. · أدخل ريبورت المبيعات: إيراد الكاش أو الفيزا.");
        if ((TaxAmount ?? 0) > NetSales)
            throw new DomainException("The tax collected cannot be more than the day's sales. · الضريبة لا تزيد عن إجمالي المبيعات.");
        Status = EndOfDayStatus.Submitted;
        SubmittedAtUtc = DateTime.UtcNow;
        SubmittedBy = by;
        Touch(by);
    }

    // A manager's: back to a draft, to be corrected and handed in again. What is posted already
    // stays posted, and is corrected on its own invoice.
    public void Reopen(string by)
    {
        if (!IsSubmitted)
            throw new DomainException("This end of day is not submitted: it can be changed as it is. · التقفيل لم يُرسل بعد.");
        Status = EndOfDayStatus.Draft;
        ReopenedAtUtc = DateTime.UtcNow;
        ReopenedBy = by;
        Touch(by);
    }

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
                $"The end of day of {Date.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} is submitted{(SubmittedBy is null ? "" : $" by {SubmittedBy}")}: a manager reopens it to change it. " +
                "· تم إرسال تقفيل هذا اليوم: يعيد المدير فتحه للتعديل.");
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

    internal EndOfDayInvoice(Guid id, Guid reportId, EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note, EndOfDayPhoto photo)
    {
        Id = id;
        ReportId = reportId;
        AddedAtUtc = DateTime.UtcNow;
        Change(kind, supplierId, reportedTotal, note);
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

    // The purchase invoice it was posted as on the daily batch, and when.
    public Guid? PurchaseInvoiceId { get; private set; }
    public DateTime? PostedAtUtc { get; private set; }

    internal void Change(EndOfDayInvoiceKind kind, Guid supplierId, decimal reportedTotal, string? note)
    {
        if (!Enum.IsDefined(kind))
            throw new DomainException("Say whether it was paid in cash or is on credit. · نقدي أم آجل.");
        if (supplierId == Guid.Empty)
            throw new DomainException("Choose the supplier. · اختر المورد.");
        if (reportedTotal <= 0)
            throw new DomainException("Enter the invoice's total, more than nothing. · أدخل إجمالي الفاتورة.");
        var cleaned = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (cleaned?.Length > EndOfDayReport.MaxInvoiceNote)
            throw new DomainException("Keep the note under 200 characters. · الملاحظة 200 حرف على الأكثر.");
        Kind = kind;
        SupplierId = supplierId;
        ReportedTotal = Math.Round(reportedTotal, 2, MidpointRounding.AwayFromZero);
        Note = cleaned;
    }

    internal void Photographed(EndOfDayPhoto photo) =>
        (PhotoFileName, PhotoContentType, PhotoBytes) = (photo.FileName, photo.ContentType, photo.Bytes);

    internal void PostedAs(Guid purchaseInvoiceId)
    {
        PurchaseInvoiceId = purchaseInvoiceId;
        PostedAtUtc ??= DateTime.UtcNow;
    }
}

// Returns each day with its Invoices loaded.
public interface IEndOfDayRepository : IRepository<EndOfDayReport>
{
    Task<EndOfDayReport?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<EndOfDayReport>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    // The day an invoice was handed in on.
    Task<EndOfDayReport?> GetByInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default);
}

// The photos handed in, kept apart from the days so a list of them never loads a megabyte each:
// an invoice's by its id, the Z report's by its day's. Written in the same unit of work.
public interface IEndOfDayPhotoStore
{
    void Put(Guid id, byte[] content);

    Task<byte[]?> GetAsync(Guid id, CancellationToken cancellationToken = default);

    void Remove(Guid id);
}
