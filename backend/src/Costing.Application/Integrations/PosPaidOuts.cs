using System.Globalization;
using System.Text;
using System.Text.Json;
using MediatR;
using Costing.Application.Books;
using Costing.Application.Common;
using Costing.Application.EndOfDay;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Integrations;
using Costing.Domain.Staff;
using Costing.Domain.Suppliers;

namespace Costing.Application.Integrations;

// ---- The POS's paid-outs (paid-out) into the end of day ----
//
// Cash a cashier paid out of the drawer during a shift, sent when the shift closes, each into the end
// of day of its business day, in the branch whose till sent it (made as a draft if it is not started:
// it waits its turn): an advance to an employee as the day's advance to them (the employee by HR's
// id, as Costing has them from HR, or by name), handed to HR as the day is; an expense as a cash
// invoice of its supplier, or of the POS's petty cash supplier when it named none. Its receipt's
// photo comes with it; without one, a slip of what the POS recorded stands for it. Kept once by the
// paid-out's id: sent again, it is what it was. A day handed in already refuses it: undone in
// Costing, the POS sends it again.

public sealed record PosPaidOutInput(
    Guid PaidOutId, Guid? ShiftId, int? ShiftNumber, DateOnly Date, string Kind, decimal Amount, string? Note, Guid? EmployeeId, string? EmployeeName,
    Guid? SupplierId, string? SupplierName, string? GivenBy, string? ReceiptContentType, byte[]? Receipt);

public sealed record PosPaidOutResultDto(Guid PaidOutId, PosSyncOutcome Outcome, DateOnly Date, string Entry, string Message);

public sealed record ReceivePosPaidOutCommand(PosPaidOutInput PaidOut) : IRequest<PosPaidOutResultDto>, IRetryOnConflict, IChecksBooksItself;

internal sealed class ReceivePosPaidOutHandler(
    IEndOfDayRepository days,
    IEndOfDayPhotoStore photos,
    ISupplierRepository suppliers,
    IStaffMemberRepository staff,
    ISyncedEmployeeRepository synced,
    BooksGuard guard,
    IBusinessCalendar calendar,
    IPosSyncJournal journal,
    IUnitOfWork unitOfWork) : IRequestHandler<ReceivePosPaidOutCommand, PosPaidOutResultDto>
{
    public const string PettyCashSupplier = "POS petty cash · نثريات نقطة البيع";
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public async Task<PosPaidOutResultDto> Handle(ReceivePosPaidOutCommand request, CancellationToken cancellationToken)
    {
        var p = request.PaidOut;
        try
        {
            var result = await RecordAsync(p, cancellationToken);
            await journal.WriteAsync(new PosSyncLog("paid-out", result.Outcome, result.Message, p.ShiftId, p.Date), cancellationToken);
            return result;
        }
        catch (Exception ex) when (ex is DomainException or NotFoundException)
        {
            await journal.WriteAsync(new PosSyncLog("paid-out", PosSyncOutcome.Refused, ex.Message, p.ShiftId, p.Date), cancellationToken);
            throw;
        }
    }

    private async Task<PosPaidOutResultDto> RecordAsync(PosPaidOutInput p, CancellationToken cancellationToken)
    {
        var advance = p.Kind switch
        {
            "StaffAdvance" => true,
            "Expense" => false,
            _ => throw new DomainException($"A paid-out of kind {p.Kind} is not one the end of day takes: expenses and advances. · نوع غير مدعوم."),
        };
        var entry = advance ? "advance" : "cash invoice";
        // Sent again: what it was.
        if ((advance ? await days.GetByPayoutAsync(p.PaidOutId, cancellationToken) : await days.GetByInvoiceAsync(p.PaidOutId, cancellationToken)) is { } had)
            return new PosPaidOutResultDto(p.PaidOutId, PosSyncOutcome.Unchanged, had.Date, entry,
                $"The {entry} of {Money(p.Amount)} is on the end of day of {Day(had.Date)} already.");
        if (p.Amount <= 0)
            throw new DomainException("A paid-out is more than nothing. · المبلغ أكبر من صفر.");
        await guard.EnsureOpenAsync([p.Date], cancellationToken);
        var today = new[] { calendar.BusinessDateOf(DateTime.UtcNow), calendar.LocalDateOf(DateTime.UtcNow) }.Max();
        if (p.Date > today)
            throw new DomainException("That day has not come yet. · هذا اليوم لم يأتِ بعد.");

        // Its day: the one started, or a new draft, which waits its turn to be handed in.
        var by = $"POS · {Clean(p.GivenBy) ?? "cashier"}";
        var day = await days.GetByDateAsync(p.Date, cancellationToken);
        if (day is { IsSubmitted: true })
            throw new DomainException(
                $"The end of day of {Day(p.Date)} is handed in already: undo it in Costing (Reports → Daily summaries), then send the shift again. · تم تقفيل اليوم بالفعل.");
        if (day is null)
        {
            if (await days.LastSubmittedDateAsync(cancellationToken) is { } last && p.Date <= last)
                throw new DomainException($"{Day(p.Date)} is before the last day closed ({Day(last)}): its end of day cannot take it. · يوم مغلق.");
            days.Add(day = new EndOfDayReport(Guid.NewGuid(), p.Date, by));
        }

        var note = Note(p);
        var (content, type, file) = Receipt(p, advance);
        var photo = EndOfDayPhoto.Of(file, type, content.Length);
        string message;
        if (advance)
        {
            var employee = await EmployeeAsync(p, cancellationToken);
            day.AddPayout(p.PaidOutId, EndOfDayPayoutKind.EmployeeAdvance, employee.Id, p.Amount, note, photo, by);
            message = $"An advance of {Money(p.Amount)} to {employee.Name} is on the end of day of {Day(p.Date)}.";
        }
        else
        {
            var supplier = await SupplierAsync(p, cancellationToken);
            day.AddInvoice(p.PaidOutId, EndOfDayInvoiceKind.Cash, supplier.Id, p.Amount, note, photo, by);
            message = $"A cash invoice of {Money(p.Amount)} from {supplier.Name} is on the end of day of {Day(p.Date)}.";
        }
        photos.Put(p.PaidOutId, content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new PosPaidOutResultDto(p.PaidOutId, PosSyncOutcome.Recorded, p.Date, entry, message);
    }

    // The employee as Costing has them: by HR's id (synced from HR), or, never synced, by name.
    private async Task<StaffMember> EmployeeAsync(PosPaidOutInput p, CancellationToken cancellationToken)
    {
        if (p.EmployeeId is { } hr && (await synced.GetAllAsync(cancellationToken)).FirstOrDefault(s => s.HrEmployeeId == hr) is { } link
            && await staff.GetByIdAsync(link.StaffMemberId, cancellationToken) is { } linked)
            return linked.IsActive ? linked : throw new DomainException($"{linked.Name} has left: bring them back on Financials → Staff first. · الموظف غير نشط.");
        var name = Clean(p.EmployeeName) ?? throw new DomainException("Say who the advance is for. · اسم الموظف.");
        var named = (await staff.GetAllAsync(cancellationToken)).Where(s => s.IsActive && string.Equals(s.Name.Trim(), name, StringComparison.OrdinalIgnoreCase)).ToList();
        return named.Count == 1
            ? named[0]
            : throw new DomainException(named.Count == 0
                ? $"{name} is not on Costing's staff: bring HR's employees in (Financials → Staff → Sync from HR), then send the shift again. · الموظف غير موجود."
                : $"Two people on Costing's staff are called {name}: choose them from HR's list on the POS. · اسم مكرر.");
    }

    // The supplier named (Costing's own id), or by name; none named: the POS's petty cash.
    private async Task<Supplier> SupplierAsync(PosPaidOutInput p, CancellationToken cancellationToken)
    {
        if (p.SupplierId is { } id && await suppliers.GetByIdAsync(id, cancellationToken) is { } known)
            return known.IsArchived ? throw new DomainException($"{known.Name} is archived in Costing: bring them back first. · المورد مؤرشف.") : known;
        var name = Clean(p.SupplierName);
        if (name is not null && await suppliers.GetByNormalizedNameAsync(Supplier.Normalize(name), cancellationToken) is { IsArchived: false } byName)
            return byName;
        if (await suppliers.GetByNormalizedNameAsync(Supplier.Normalize(PettyCashSupplier), cancellationToken) is { } petty)
            return petty;
        var made = new Supplier(Guid.NewGuid(), new SupplierDetails(PettyCashSupplier, Notes: "Cash expenses paid out of the POS drawer with no supplier named."));
        suppliers.Add(made);
        return made;
    }

    private static string? Note(PosPaidOutInput p)
    {
        var shift = p.ShiftNumber is { } n ? $"POS shift {n}" : "POS";
        var text = Clean(p.Note);
        var supplier = p.SupplierId is null ? Clean(p.SupplierName) : null;
        var full = string.Join(" · ", new[] { text, supplier, shift }.Where(t => t is not null));
        return full.Length > EndOfDayReport.MaxPayoutNote ? full[..EndOfDayReport.MaxPayoutNote] : full;
    }

    // Its photo as sent, or a slip of what the POS recorded.
    private static (byte[] Content, string Type, string File) Receipt(PosPaidOutInput p, bool advance)
    {
        if (p.Receipt is { Length: > 0 } bytes && p.ReceiptContentType is { } type)
            return (bytes, type.Trim().ToLowerInvariant(), $"pos-receipt-{p.PaidOutId:N}{Extension(type)}");
        var lines = new List<string>
        {
            advance ? "POS paid-out: staff advance" : "POS paid-out: cash expense",
            $"Day: {p.Date:yyyy-MM-dd}" + (p.ShiftNumber is { } n ? $"   Shift: {n}" : ""),
            $"Amount: {p.Amount.ToString("N2", Invariant)}",
        };
        if (advance)
            lines.Add($"Employee: {Clean(p.EmployeeName) ?? "-"}");
        else
            lines.Add($"Supplier: {Clean(p.SupplierName) ?? "none named"}");
        lines.Add($"For: {Clean(p.Note) ?? "-"}");
        lines.Add($"Paid out by: {Clean(p.GivenBy) ?? "-"}");
        lines.Add($"Paid-out id: {p.PaidOutId}");
        lines.Add("No photo was taken at the till: this slip is what the POS recorded.");
        return (PosSlip.Pdf(lines), "application/pdf", $"pos-paid-out-{p.PaidOutId:N}.pdf");
    }

    private static string Extension(string type) => type.Trim().ToLowerInvariant() switch
    {
        "application/pdf" => ".pdf",
        "image/png" => ".png",
        "image/webp" => ".webp",
        _ => ".jpg",
    };

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static string Money(decimal amount) => amount.ToString("N2", Invariant);

    private static string Day(DateOnly date) => date.ToString("d MMM yyyy", Invariant);
}

// A one-page PDF of lines of text (Helvetica): the slip that stands for a receipt the till did not
// photograph. Its standard font has no Arabic, so a character it cannot show is a question mark.
internal static class PosSlip
{
    public static byte[] Pdf(IReadOnlyList<string> lines)
    {
        var content = new StringBuilder("BT /F1 12 Tf 50 790 Td 18 TL\n");
        foreach (var line in lines)
            content.Append('(').Append(Escape(line)).Append(") Tj T*\n");
        content.Append("ET");
        var stream = content.ToString();
        var objects = new[]
        {
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            $"<< /Length {Encoding.ASCII.GetByteCount(stream)} >>\nstream\n{stream}\nendstream",
        };
        var pdf = new StringBuilder("%PDF-1.4\n");
        var offsets = new List<int>();
        for (var i = 0; i < objects.Length; i++)
        {
            offsets.Add(Encoding.ASCII.GetByteCount(pdf.ToString()));
            pdf.Append(i + 1).Append(" 0 obj\n").Append(objects[i]).Append("\nendobj\n");
        }
        var xref = Encoding.ASCII.GetByteCount(pdf.ToString());
        pdf.Append("xref\n0 ").Append(objects.Length + 1).Append("\n0000000000 65535 f \n");
        foreach (var offset in offsets)
            pdf.Append(offset.ToString("D10", CultureInfo.InvariantCulture)).Append(" 00000 n \n");
        pdf.Append("trailer\n<< /Size ").Append(objects.Length + 1).Append(" /Root 1 0 R >>\nstartxref\n").Append(xref).Append("\n%%EOF\n");
        return Encoding.ASCII.GetBytes(pdf.ToString());
    }

    private static string Escape(string text)
    {
        var builder = new StringBuilder();
        foreach (var c in text)
        {
            if (c is '\\' or '(' or ')')
                builder.Append('\\').Append(c);
            else
                builder.Append(c is >= ' ' and <= '~' ? c : '?');
        }
        return builder.ToString();
    }
}

// ---- The suppliers, for the POS's paid-out form ----

public sealed record PosSupplierDto(Guid Id, string Name, string? NameAr);

public sealed record GetPosSuppliersQuery : IRequest<IReadOnlyList<PosSupplierDto>>;

internal sealed class GetPosSuppliersHandler(ISupplierRepository suppliers) : IRequestHandler<GetPosSuppliersQuery, IReadOnlyList<PosSupplierDto>>
{
    public async Task<IReadOnlyList<PosSupplierDto>> Handle(GetPosSuppliersQuery request, CancellationToken cancellationToken) =>
        (await suppliers.GetAllAsync(cancellationToken)).Where(s => !s.IsArchived).OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(s => new PosSupplierDto(s.Id, s.Name, null)).ToList();
}

// paid-out's data, as the POS sends it.
public static class PosPaidOutEvent
{
    public const string Kind = "paid-out";

    public static PosPaidOutInput Read(JsonElement data)
    {
        string? Text(string name) => data.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        Guid? Id(string name) => Guid.TryParse(Text(name), out var id) ? id : null;
        var paidOutId = Id("paidOutId") ?? throw new DomainException("paid-out has no paidOutId.");
        var date = DateOnly.Parse(Text("businessDate") ?? throw new DomainException("paid-out has no businessDate."), CultureInfo.InvariantCulture);
        var amount = data.TryGetProperty("amount", out var a) && a.ValueKind == JsonValueKind.Number ? a.GetDecimal() : 0;
        string? type = null;
        byte[]? receipt = null;
        if (data.TryGetProperty("receipt", out var r) && r.ValueKind == JsonValueKind.Object
            && r.TryGetProperty("base64", out var b) && b.ValueKind == JsonValueKind.String)
        {
            receipt = Convert.FromBase64String(b.GetString()!);
            type = r.TryGetProperty("contentType", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
        }
        return new PosPaidOutInput(
            paidOutId, Id("shiftId"), data.TryGetProperty("shiftNumber", out var n) && n.ValueKind == JsonValueKind.Number ? n.GetInt32() : null, date,
            Text("kind") ?? string.Empty, amount, Text("note"), Id("employeeId"), Text("employeeName"), Id("supplierId"), Text("supplierName"),
            Text("givenBy"), type, receipt);
    }
}
