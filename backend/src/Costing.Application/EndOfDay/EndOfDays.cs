using System.Globalization;
using MediatR;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;

namespace Costing.Application.EndOfDay;

// The end of the day (تقفيل اليوم) as a branch hands it in: the day's invoices photographed, each
// paid in cash out of the takings or bought on credit, with its supplier and the total on it, and
// the day's sales report. Filled in as a draft, an invoice at a time so a phone sends one photo at
// a time; submitted, it is kept as it is for the daily batch, where each invoice is transcribed from
// its photo, and for the day's takings. A manager reopens one to correct it. The day is made by its
// first entry; an invoice's id is made by the till, so one sent again is not added twice.

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
    DateTime? PostedAtUtc);

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
    DateTime? ReopenedAtUtc);

public sealed record EndOfDayPhotoFile(string FileName, string ContentType, byte[] Content);

public sealed record GetEndOfDayQuery(DateOnly Date) : IRequest<EndOfDayDto?>;

// The days handed in over a period, latest first, without their photos.
public sealed record GetEndOfDaysQuery(DateOnly From, DateOnly To) : IRequest<IReadOnlyList<EndOfDayDto>>;

public sealed record SaveEndOfDaySalesCommand(
    DateOnly Date, decimal? CashAmount, decimal? CardAmount, decimal? TaxAmount, decimal? VoidsAmount, string? Notes, string StaffName = "")
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
    string StaffName = "") : IRequest<EndOfDayDto>;

public sealed record ChangeEndOfDayInvoiceCommand(
    DateOnly Date, Guid InvoiceId, EndOfDayInvoiceKind Kind, Guid SupplierId, decimal ReportedTotal, string? Note, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record ReplaceEndOfDayInvoicePhotoCommand(DateOnly Date, Guid InvoiceId, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record RemoveEndOfDayInvoiceCommand(DateOnly Date, Guid InvoiceId, string StaffName = "") : IRequest<EndOfDayDto>;

public sealed record AttachEndOfDaySalesPhotoCommand(DateOnly Date, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record RemoveEndOfDaySalesPhotoCommand(DateOnly Date, string StaffName = "") : IRequest<EndOfDayDto>;

public sealed record SubmitEndOfDayCommand(DateOnly Date, string StaffName = "") : IRequest<EndOfDayDto>;

public sealed record ReopenEndOfDayCommand(DateOnly Date, string StaffName = "") : IRequest<EndOfDayDto>;

// A photo of the day: an invoice's by its id, the sales report's by the day's.
public sealed record GetEndOfDayPhotoQuery(DateOnly Date, Guid PhotoId) : IRequest<EndOfDayPhotoFile?>;

// What the use cases share: the day, made by its first entry; the photo checked; the day as shown.
internal sealed class EndOfDayDays(
    IEndOfDayRepository days, IEndOfDayPhotoStore photos, ISupplierRepository suppliers, ISafeTransactionRepository safe, IBusinessCalendar calendar)
{
    public IEndOfDayPhotoStore Photos => photos;

    public async Task<EndOfDayReport> OpenAsync(DateOnly date, string by, CancellationToken cancellationToken)
    {
        if (await days.GetByDateAsync(date, cancellationToken) is { } day)
            return day;
        var now = DateTime.UtcNow;
        if (date > new[] { calendar.BusinessDateOf(now), calendar.LocalDateOf(now) }.Max())
            throw new DomainException("That day has not come yet: close a day once it is over. · هذا اليوم لم يأتِ بعد.");
        days.Add(day = new EndOfDayReport(Guid.NewGuid(), date, by));
        return day;
    }

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
        var dtos = new List<EndOfDayDto>();
        foreach (var day in list)
        {
            var takings = await safe.GetTakingsAsync(day.Date, cancellationToken);
            dtos.Add(new EndOfDayDto(
                day.Id, day.Date, day.Status, day.CashAmount, day.CardAmount, day.TaxAmount, day.VoidsAmount, day.Notes,
                EndOfDayPhotoDto.From(day.SalesPhoto),
                day.Invoices.Select(i => new EndOfDayInvoiceDto(
                    i.Id, i.Kind, i.SupplierId, names.GetValueOrDefault(i.SupplierId, "A removed supplier"), i.ReportedTotal, i.Note,
                    EndOfDayPhotoDto.From(i.Photo)!, i.AddedAtUtc, i.PurchaseInvoiceId, i.PostedAtUtc)).ToList(),
                day.CountOf(EndOfDayInvoiceKind.Cash), day.TotalOf(EndOfDayInvoiceKind.Cash),
                day.CountOf(EndOfDayInvoiceKind.Credit), day.TotalOf(EndOfDayInvoiceKind.Credit),
                day.NetSales, day.TotalRevenue, day.CashAfterInvoices, day.ExpectedIntoSafe,
                day.Invoices.Count(i => i.PurchaseInvoiceId is not null), takings?.TakingsTotal,
                day.CreatedBy, day.CreatedAtUtc, day.UpdatedBy, day.UpdatedAtUtc, day.SubmittedBy, day.SubmittedAtUtc, day.ReopenedBy, day.ReopenedAtUtc));
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
        day.RecordSales(request.CashAmount, request.CardAmount, request.TaxAmount, request.VoidsAmount, request.Notes, request.StaffName);
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
        day.AddInvoice(request.InvoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, photo, request.StaffName);
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
        day.ChangeInvoice(request.InvoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, request.StaffName);
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

internal sealed class SubmitEndOfDayCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<SubmitEndOfDayCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(SubmitEndOfDayCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        // Sent again after an answer was lost: submitted already.
        if (!day.IsSubmitted)
        {
            day.Submit(request.StaffName);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class ReopenEndOfDayCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<ReopenEndOfDayCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(ReopenEndOfDayCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        day.Reopen(request.StaffName);
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
        var photo = request.PhotoId == day.Id ? day.SalesPhoto : day.Invoices.FirstOrDefault(i => i.Id == request.PhotoId)?.Photo;
        return photo is not null && await photos.GetAsync(request.PhotoId, cancellationToken) is { } content
            ? new EndOfDayPhotoFile(photo.FileName, photo.ContentType, content)
            : null;
    }
}
