using System.Globalization;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.EndOfDay;
using Costing.Domain.Access;
using Costing.Domain.EndOfDay;
using Costing.Domain.Purchases;

namespace Costing.Api.Controllers;

// The end of the day (تقفيل اليوم): the day's invoices handed in with their photos, cash and on
// credit; the cash paid out of the till to suppliers and as advances to employees, each with its
// receipt; and its sales report with the opening float, filled in by whoever works the End of day
// section (a branch can work it alone) and submitted. Whoever works Purchases or Financials reads it
// too: the daily batch makes an invoice of each, the takings come from its sales. Submitted, each
// payment and advance becomes the safe's entry out of the day's takings: at once for a manager,
// asked of one for anyone else. A day is reopened by a manager. Dates are the business day's,
// yyyy-MM-dd.
[ApiController]
[Route("api/end-of-day")]
[Authorize(Policy = Permissions.InventoryManage)]
public sealed class EndOfDayController(ISender sender) : ControllerBase
{
    private const CostingTabs Readers = CostingTabs.EndOfDay | CostingTabs.Purchases | CostingTabs.Financials;
    private const long UploadLimit = PurchaseInvoice.MaxAttachmentBytes + 64 * 1024;

    // The days of a period, latest first.
    [HttpGet]
    [CostingTab(Readers)]
    public Task<IReadOnlyList<EndOfDayDto>> GetDays([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        sender.Send(new GetEndOfDaysQuery(from, to), cancellationToken);

    // The day, or nothing (204) before anything is handed in for it.
    [HttpGet("{date}")]
    [CostingTab(Readers)]
    public async Task<ActionResult<EndOfDayDto?>> GetDay(DateOnly date, CancellationToken cancellationToken) =>
        await sender.Send(new GetEndOfDayQuery(date), cancellationToken);

    [HttpPut("{date}/sales")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> SaveSales(DateOnly date, EndOfDaySalesRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveEndOfDaySalesCommand(
            date, request.CashAmount, request.CardAmount, request.TaxAmount, request.VoidsAmount, request.Notes, StaffName, request.OpeningFloat), cancellationToken);

    // An invoice handed in, with its photo: a form of invoiceId (made by the till), kind (Cash or
    // Credit), supplierId, reportedTotal, note and file.
    [HttpPost("{date}/invoices")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public async Task<ActionResult<EndOfDayDto>> AddInvoice(DateOnly date, [FromForm] EndOfDayInvoiceForm form, CancellationToken cancellationToken)
    {
        if (form.File is not { } file)
            return Refused("Photograph the invoice or attach its file. · صوّر الفاتورة أو أرفق ملفها.");
        if (!Guid.TryParse(form.InvoiceId, out var invoiceId) || !Guid.TryParse(form.SupplierId, out var supplierId))
            return Refused("Choose the supplier. · اختر المورد.");
        if (!Enum.TryParse<EndOfDayInvoiceKind>(form.Kind, true, out var kind) || !Enum.IsDefined(kind))
            return Refused("Say whether it was paid in cash or is on credit. · نقدي أم آجل.");
        if (!decimal.TryParse(form.ReportedTotal, NumberStyles.Number, CultureInfo.InvariantCulture, out var total))
            return Refused("Enter the invoice's total. · أدخل إجمالي الفاتورة.");
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return Refused("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        return await sender.Send(new AddEndOfDayInvoiceCommand(
            date, invoiceId, kind, supplierId, total, form.Note, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName), cancellationToken);
    }

    [HttpPut("{date}/invoices/{invoiceId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> ChangeInvoice(DateOnly date, Guid invoiceId, EndOfDayInvoiceRequest request, CancellationToken cancellationToken) =>
        sender.Send(new ChangeEndOfDayInvoiceCommand(date, invoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, StaffName), cancellationToken);

    [HttpPut("{date}/invoices/{invoiceId:guid}/photo")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public async Task<ActionResult<EndOfDayDto>> ReplaceInvoicePhoto(DateOnly date, Guid invoiceId, IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return Refused("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        return await sender.Send(new ReplaceEndOfDayInvoicePhotoCommand(
            date, invoiceId, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName), cancellationToken);
    }

    [HttpDelete("{date}/invoices/{invoiceId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> RemoveInvoice(DateOnly date, Guid invoiceId, CancellationToken cancellationToken) =>
        sender.Send(new RemoveEndOfDayInvoiceCommand(date, invoiceId, StaffName), cancellationToken);

    // Cash paid to a supplier out of the till, with its receipt (إيصال السداد / إذن الصرف): a form of
    // id (made by the till), supplierId, amount, note and file.
    [HttpPost("{date}/supplier-payments")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public Task<ActionResult<EndOfDayDto>> AddSupplierPayment(DateOnly date, [FromForm] EndOfDayPayoutForm form, CancellationToken cancellationToken) =>
        AddPayout(date, EndOfDayPayoutKind.SupplierPayment, form.Id, form.SupplierId, form, cancellationToken);

    // An advance to an employee out of the till, with its signed receipt (إيصال صرف السلفة): a form
    // of id (made by the till), employeeId, amount, note and file.
    [HttpPost("{date}/advances")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public Task<ActionResult<EndOfDayDto>> AddAdvance(DateOnly date, [FromForm] EndOfDayPayoutForm form, CancellationToken cancellationToken) =>
        AddPayout(date, EndOfDayPayoutKind.EmployeeAdvance, form.Id, form.EmployeeId, form, cancellationToken);

    [HttpPut("{date}/supplier-payments/{payoutId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> ChangeSupplierPayment(DateOnly date, Guid payoutId, EndOfDayPayoutRequest request, CancellationToken cancellationToken) =>
        sender.Send(new ChangeEndOfDayPayoutCommand(date, payoutId, request.SupplierId ?? Guid.Empty, request.Amount, request.Note, StaffName), cancellationToken);

    [HttpPut("{date}/advances/{payoutId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> ChangeAdvance(DateOnly date, Guid payoutId, EndOfDayPayoutRequest request, CancellationToken cancellationToken) =>
        sender.Send(new ChangeEndOfDayPayoutCommand(date, payoutId, request.EmployeeId ?? Guid.Empty, request.Amount, request.Note, StaffName), cancellationToken);

    [HttpPut("{date}/supplier-payments/{payoutId:guid}/receipt")]
    [HttpPut("{date}/advances/{payoutId:guid}/receipt")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public async Task<ActionResult<EndOfDayDto>> ReplacePayoutReceipt(DateOnly date, Guid payoutId, IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return Refused("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        return await sender.Send(new ReplaceEndOfDayPayoutReceiptCommand(
            date, payoutId, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName), cancellationToken);
    }

    [HttpDelete("{date}/supplier-payments/{payoutId:guid}")]
    [HttpDelete("{date}/advances/{payoutId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> RemovePayout(DateOnly date, Guid payoutId, CancellationToken cancellationToken) =>
        sender.Send(new RemoveEndOfDayPayoutCommand(date, payoutId, StaffName), cancellationToken);

    // The Z report's photo.
    [HttpPut("{date}/sales-photo")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public async Task<ActionResult<EndOfDayDto>> AttachSalesPhoto(DateOnly date, IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return Refused("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        return await sender.Send(new AttachEndOfDaySalesPhotoCommand(
            date, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName), cancellationToken);
    }

    [HttpDelete("{date}/sales-photo")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> RemoveSalesPhoto(DateOnly date, CancellationToken cancellationToken) =>
        sender.Send(new RemoveEndOfDaySalesPhotoCommand(date, StaffName), cancellationToken);

    [HttpPost("{date}/submit")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> Submit(DateOnly date, CancellationToken cancellationToken) =>
        sender.Send(new SubmitEndOfDayCommand(date, StaffName, StaffId, CanApprove), cancellationToken);

    [HttpPost("{date}/reopen")]
    [CostingTab(Readers)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<EndOfDayDto> Reopen(DateOnly date, CancellationToken cancellationToken) =>
        sender.Send(new ReopenEndOfDayCommand(date, StaffName), cancellationToken);

    // An invoice's photo or a payment's receipt by its id, the Z report's by the day's.
    [HttpGet("{date}/photos/{photoId:guid}")]
    [CostingTab(Readers)]
    public async Task<IActionResult> GetPhoto(DateOnly date, Guid photoId, [FromQuery] bool download, CancellationToken cancellationToken)
    {
        if (await sender.Send(new GetEndOfDayPhotoQuery(date, photoId), cancellationToken) is not { } photo)
            return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        return download ? File(photo.Content, photo.ContentType, photo.FileName) : File(photo.Content, photo.ContentType);
    }

    private async Task<ActionResult<EndOfDayDto>> AddPayout(
        DateOnly date, EndOfDayPayoutKind kind, string? id, string? payee, EndOfDayPayoutForm form, CancellationToken cancellationToken)
    {
        var toSupplier = kind == EndOfDayPayoutKind.SupplierPayment;
        if (form.File is not { } file)
            return Refused(toSupplier
                ? "Photograph the payment receipt or attach its file. · صوّر إيصال السداد أو أرفق ملفه."
                : "Photograph the signed advance receipt or attach its file. · صوّر إيصال صرف السلفة أو أرفق ملفه.");
        if (!Guid.TryParse(id, out var payoutId))
            return Refused("The payment has no id: send it again from the page.");
        if (!Guid.TryParse(payee, out var payeeId))
            return Refused(toSupplier ? "Choose the supplier. · اختر المورد." : "Choose the employee. · اختر الموظف.");
        if (!decimal.TryParse(form.Amount, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount))
            return Refused("Enter the amount paid. · أدخل المبلغ المدفوع.");
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return Refused("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        return await sender.Send(new AddEndOfDayPayoutCommand(
            date, payoutId, kind, payeeId, amount, form.Note, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName), cancellationToken);
    }

    private UnprocessableEntityObjectResult Refused(string message) => UnprocessableEntity(new { errors = new[] { message } });

    private static async Task<byte[]> ContentOf(IFormFile file, CancellationToken cancellationToken)
    {
        using var content = new MemoryStream();
        await file.CopyToAsync(content, cancellationToken);
        return content.ToArray();
    }

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;

    private string StaffId => UserClaims.IdOf(User) ?? string.Empty;

    // A manager's safe entries are entered at once; anyone else's are asked of a manager.
    private bool CanApprove => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide);
}

public sealed record EndOfDaySalesRequest(decimal? CashAmount, decimal? CardAmount, decimal? TaxAmount, decimal? VoidsAmount, string? Notes, decimal? OpeningFloat = null);

// A payment changed: the supplier paid (a supplier payment's) or the employee advanced (an advance's).
public sealed record EndOfDayPayoutRequest(Guid? SupplierId, Guid? EmployeeId, decimal Amount, string? Note);

// As the till sends it, text: the amount is read with a point for its decimals, whatever the server's language.
public sealed class EndOfDayPayoutForm
{
    public string? Id { get; set; }
    public string? SupplierId { get; set; }
    public string? EmployeeId { get; set; }
    public string? Amount { get; set; }
    public string? Note { get; set; }
    public IFormFile? File { get; set; }
}

public sealed record EndOfDayInvoiceRequest(EndOfDayInvoiceKind Kind, Guid SupplierId, decimal ReportedTotal, string? Note);

// As the till sends it, text: the total is read with a point for its decimals, whatever the server's language.
public sealed class EndOfDayInvoiceForm
{
    public string? InvoiceId { get; set; }
    public string? Kind { get; set; }
    public string? SupplierId { get; set; }
    public string? ReportedTotal { get; set; }
    public string? Note { get; set; }
    public IFormFile? File { get; set; }
}
