using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.EndOfDay;
using Costing.Application.FixedAssets;
using Costing.Application.Integrations;
using Costing.Application.Production;
using Costing.Application.Purchases;
using Costing.Application.Sales;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.EndOfDay;
using Costing.Domain.FixedAssets;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.Sales;
using Costing.Domain.Staff;

namespace Costing.Application.Books;

// The days of the records a request names, for the books' lock: what it posts, voids, refunds,
// moves or approves belongs to the day it was entered on, whenever the request is made. Each looks
// up what it needs and nothing more, and only once the books are locked at all.

internal static class InvoiceDays
{
    public static IEnumerable<DateOnly?> Of(PurchaseInvoice invoice, IBusinessCalendar calendar) =>
        [invoice.InvoiceDate ?? calendar.BusinessDateOf(invoice.PostedAtUtc ?? invoice.CreatedAtUtc), invoice.RevenueDate];
}

// A draft posted: its date, and the takings it is paid from.
internal sealed class PostPurchaseInvoiceDays(IPurchaseInvoiceRepository invoices, IBusinessCalendar calendar) : IBooksDays<PostPurchaseInvoiceCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(PostPurchaseInvoiceCommand request, CancellationToken cancellationToken) =>
        await invoices.GetByIdAsync(request.InvoiceId, cancellationToken) is { } invoice ? InvoiceDays.Of(invoice, calendar) : [];
}

// A correction voids the original: its day as well as the correction's.
internal sealed class CorrectPurchaseInvoiceDays(IPurchaseInvoiceRepository invoices, IBusinessCalendar calendar)
    : IBooksDays<CorrectPurchaseInvoiceCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(CorrectPurchaseInvoiceCommand request, CancellationToken cancellationToken) =>
        await invoices.GetByIdAsync(request.InvoiceId, cancellationToken) is { } invoice ? InvoiceDays.Of(invoice, calendar) : [];
}

// Paid in cash today; on credit, owed to the supplier from the invoice's own day.
internal sealed class PayPurchaseInvoiceDays(IPurchaseInvoiceRepository invoices, IBusinessCalendar calendar) : IBooksDays<PayPurchaseInvoiceCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(PayPurchaseInvoiceCommand request, CancellationToken cancellationToken) =>
        request.Method == PurchasePaymentMethod.Credit && await invoices.GetByIdAsync(request.InvoiceId, cancellationToken) is { } invoice
            ? InvoiceDays.Of(invoice, calendar).Take(1)
            : [];
}

// A refund changes the sale, of its own day.
internal sealed class RefundSaleDays(ISalesReceiptRepository sales) : IBooksDays<RefundSaleCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(RefundSaleCommand request, CancellationToken cancellationToken) =>
        await sales.GetByIdAsync(request.SaleId, cancellationToken) is { } sale ? [sale.BusinessDate] : [];
}

// A draft moved off a day: the day it leaves.
internal sealed class ReassignEndOfDayDays(IEndOfDayRepository days) : IBooksDays<ReassignEndOfDayDateCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(ReassignEndOfDayDateCommand request, CancellationToken cancellationToken) =>
        await days.GetByIdAsync(request.Id, cancellationToken) is { } day ? [day.Date] : [];
}

internal sealed class VoidStaffDeductionDays(IStaffDeductionRepository deductions) : IBooksDays<VoidStaffDeductionCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(VoidStaffDeductionCommand request, CancellationToken cancellationToken) =>
        await deductions.GetByIdAsync(request.Id, cancellationToken) is { } deduction ? [deduction.Date] : [];
}

// A batch corrected: the batch it replaces is voided on its own day.
internal sealed class ReviseProductionOrderDays(IProductionOrderRepository orders, IBusinessCalendar calendar)
    : IBooksDays<ReviseProductionOrderCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(ReviseProductionOrderCommand request, CancellationToken cancellationToken) =>
        await orders.GetByIdAsync(request.OrderId, cancellationToken) is { } order ? [calendar.BusinessDateOf(order.ProducedAtUtc)] : [];
}

// An asset's purchase restated (its day, its cost, its life or salvage, which its depreciation
// follows from the day bought): that day. Its name, place or notes alone: none.
internal sealed class ChangeFixedAssetDays(IFixedAssetRepository assets) : IBooksDays<ChangeFixedAssetCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(ChangeFixedAssetCommand request, CancellationToken cancellationToken)
    {
        if (await assets.GetByIdAsync(request.AssetId, cancellationToken) is not { } asset)
            return [];
        var restated = (request.PurchaseDate is { } day && day != asset.PurchaseDate) || (request.PurchaseCost is { } cost && cost != asset.PurchaseCost)
            || request.Asset.UsefulLifeMonths != asset.UsefulLifeMonths || request.Asset.SalvageValue != asset.SalvageValue;
        return restated ? [asset.PurchaseDate, request.PurchaseDate] : [];
    }
}

internal sealed class RemoveFixedAssetDays(IFixedAssetRepository assets) : IBooksDays<RemoveFixedAssetCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(RemoveFixedAssetCommand request, CancellationToken cancellationToken) =>
        await assets.GetByIdAsync(request.AssetId, cancellationToken) is { } asset ? [asset.PurchaseDate, asset.DisposalDate] : [];
}

internal sealed class ReinstateFixedAssetDays(IFixedAssetRepository assets) : IBooksDays<ReinstateFixedAssetCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(ReinstateFixedAssetCommand request, CancellationToken cancellationToken) =>
        await assets.GetByIdAsync(request.AssetId, cancellationToken) is { } asset ? [asset.DisposalDate] : [];
}

// A transfer voided: the day it was made.
internal sealed class VoidInternalTransferDays(Costing.Domain.Stock.IInternalTransferRepository transfers) : IBooksDays<Stock.VoidInternalTransferCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(Stock.VoidInternalTransferCommand request, CancellationToken cancellationToken) =>
        await transfers.GetByIdAsync(request.Id, cancellationToken) is { } transfer ? [transfer.TransferDate] : [];
}

// A deletion, asked for or done at once: the record's own day.
internal sealed class RequestDeletionDays(DeletionTargets deletions) : IBooksDays<RequestDeletionCommand>
{
    public Task<IEnumerable<DateOnly?>> DaysAsync(RequestDeletionCommand request, CancellationToken cancellationToken) =>
        request.Module == ApprovalModule.PurchaseCategory ? Task.FromResult<IEnumerable<DateOnly?>>([]) : deletions.DaysAsync(request.Module, request.RecordId, cancellationToken);
}

// A manager's yes does what was asked, so it is held to the days of what it does: what it deletes,
// the voucher it pays, the invoice it posts or corrects, the batch it makes (today) or replaces.
internal sealed class ApproveRequestDays(
    IApprovalRequestRepository requests,
    DeletionTargets deletions,
    IPurchaseInvoiceRepository invoices,
    IProductionOrderRepository orders,
    IBusinessCalendar calendar) : IBooksDays<ApproveRequestCommand>
{
    public async Task<IEnumerable<DateOnly?>> DaysAsync(ApproveRequestCommand request, CancellationToken cancellationToken)
    {
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is not { IsPending: true } approval)
            return [];
        var today = calendar.BusinessDateOf(DateTime.UtcNow);
        switch (approval.Action, approval.Module)
        {
            case (ApprovalAction.Delete, ApprovalModule.PurchaseCategory):
                return [];
            case (ApprovalAction.Delete, _):
                return await deletions.DaysAsync(approval.Module, approval.RecordId, cancellationToken);
            case (ApprovalAction.Create, ApprovalModule.ProductionOrder):
                return [today];
            case (ApprovalAction.Create, ApprovalModule.Treasury):
            {
                var voucher = ApprovalPayload.Read<SafeVoucher>(approval);
                return [voucher.Date, voucher.RevenueDate];
            }
            case (ApprovalAction.Create, ApprovalModule.PurchaseInvoice):
                return await invoices.GetByIdAsync(approval.RecordId, cancellationToken) is { } posted ? InvoiceDays.Of(posted, calendar) : [];
            case (ApprovalAction.Update, ApprovalModule.PurchaseInvoice):
            {
                var correction = ApprovalPayload.Read<InvoiceCorrection>(approval);
                var original = await invoices.GetByIdAsync(approval.RecordId, cancellationToken);
                return (original is null ? [] : InvoiceDays.Of(original, calendar)).Concat([correction.InvoiceDate, correction.RevenueDate]);
            }
            case (ApprovalAction.Update, ApprovalModule.ProductionOrder):
                return await orders.GetByIdAsync(approval.RecordId, cancellationToken) is { } order
                    ? [calendar.BusinessDateOf(order.ProducedAtUtc), today]
                    : [today];
            default:
                // A purchase order, a prep item, a material's unit: none of the books.
                return [];
        }
    }
}
