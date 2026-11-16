using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Approvals;
using Costing.Application.FixedAssets;
using Costing.Application.Treasury;
using Costing.Domain.Access;
using Costing.Domain.FixedAssets;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// The fixed assets register (سجل الأصول الثابتة) on Financials. Buying an asset (CAPEX) out of the
// safe or the bank, or selling one for money, is a safe entry: entered at once for a manager (200),
// asked of one for anyone else (202), voided as any entry is (a deletion request, module Treasury,
// on its entry). What moves no cash is a manager's: an asset owned already, its details changed, a
// write-off, that undone, one owned already taken off.
[ApiController]
[Route("api/financials/fixed-assets")]
[Authorize(Policy = Permissions.InventoryManage)]
[CostingTab(CostingTabs.Financials)]
public sealed class FixedAssetsController(ISender sender, FixedAssetService assets) : ControllerBase
{
    private const string ManagersOnly =
        "This moves no cash but changes the profit and loss: it is a manager's. · هذا الإجراء للمدير.";

    // The register at the end of a month (this one when none is chosen).
    [HttpGet]
    public Task<FixedAssetRegister> GetRegister([FromQuery] int? year, [FromQuery] int? month, CancellationToken cancellationToken) =>
        assets.GetRegisterAsync(year, month, cancellationToken);

    [HttpGet("export")]
    public async Task<IActionResult> Export([FromQuery] int? year, [FromQuery] int? month, CancellationToken cancellationToken)
    {
        var register = await assets.GetRegisterAsync(year, month, cancellationToken);
        return File(FixedAssetWorkbook.Build(register), ReportWorkbook.ContentType, FixedAssetWorkbook.FileName(register));
    }

    // An asset bought (شراء أصل ثابت): out of the safe or the bank on the day, or owned already.
    [HttpPost]
    public async Task<IActionResult> Acquire(AcquireFixedAssetRequest request, CancellationToken cancellationToken)
    {
        var input = new FixedAssetInput(request.Name, request.Category, request.UsefulLifeMonths, request.SalvageValue, request.Location, request.Notes);
        if (request.PaidFrom == AssetPaymentSource.OwnedAlready)
        {
            if (!CanApprove)
                return Problem(statusCode: StatusCodes.Status403Forbidden, title: "A manager's.", detail: ManagersOnly);
            var saved = await sender.Send(
                new RegisterOwnedAssetCommand(request.AssetId, input, request.PurchaseDate, request.PurchaseCost, StaffName), cancellationToken);
            return Ok(new FixedAssetResult(ApprovalOutcome.Applied, saved.Id, saved.AssetCode, null, null));
        }

        var voucher = new SafeVoucher(
            request.TransactionId, SafeTransactionKind.AssetPurchase, request.PurchaseCost, request.PurchaseDate, Notes: request.Notes,
            Fund: request.PaidFrom == AssetPaymentSource.Bank ? CashFund.Bank : CashFund.Safe, FixedAssetId: request.AssetId, Asset: input);
        return await RecordAsync(request.RequestId, voucher, request.AssetId, request.Reason, cancellationToken);
    }

    [HttpPut("{assetId:guid}")]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public async Task<FixedAssetSaved> Change(Guid assetId, ChangeFixedAssetRequest request, CancellationToken cancellationToken) =>
        await sender.Send(new ChangeFixedAssetCommand(
            assetId, new FixedAssetInput(request.Name, request.Category, request.UsefulLifeMonths, request.SalvageValue, request.Location, request.Notes),
            request.PurchaseDate, request.PurchaseCost, StaffName), cancellationToken);

    // Disposed of or sold (استبعاد أو بيع الأصل): its depreciation stops. Sold for money, what it
    // brought in goes into the safe or the bank by a safe entry; for nothing, it is written off.
    [HttpPost("{assetId:guid}/dispose")]
    public async Task<IActionResult> Dispose(Guid assetId, DisposeFixedAssetRequest request, CancellationToken cancellationToken)
    {
        if (request.SaleProceeds is > 0 and var proceeds)
        {
            var voucher = new SafeVoucher(
                request.TransactionId, SafeTransactionKind.AssetSale, proceeds, request.Date, Notes: request.Notes,
                Fund: request.Fund ?? CashFund.Safe, FixedAssetId: assetId);
            return await RecordAsync(request.RequestId, voucher, assetId, request.Reason, cancellationToken);
        }
        if (!CanApprove)
            return Problem(statusCode: StatusCodes.Status403Forbidden, title: "A manager's.", detail: ManagersOnly);
        var saved = await sender.Send(new WriteOffFixedAssetCommand(assetId, request.Date, request.Notes, StaffName), cancellationToken);
        return Ok(new FixedAssetResult(ApprovalOutcome.Applied, saved.Id, saved.AssetCode, null, null));
    }

    // A write-off undone. A sale is undone by voiding its entry.
    [HttpPost("{assetId:guid}/reinstate")]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<FixedAssetSaved> Reinstate(Guid assetId, CancellationToken cancellationToken) =>
        sender.Send(new ReinstateFixedAssetCommand(assetId, StaffName), cancellationToken);

    // One owned already, off the register. A paid one goes with its purchase voided.
    [HttpDelete("{assetId:guid}")]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public async Task<IActionResult> Remove(Guid assetId, CancellationToken cancellationToken)
    {
        await sender.Send(new RemoveFixedAssetCommand(assetId, StaffName), cancellationToken);
        return NoContent();
    }

    private async Task<IActionResult> RecordAsync(Guid requestId, SafeVoucher voucher, Guid assetId, string? reason, CancellationToken cancellationToken)
    {
        var result = await sender.Send(
            new RecordSafeVoucherCommand(requestId, voucher, reason, UserClaims.IdOf(User) ?? string.Empty, StaffName, CanApprove), cancellationToken);
        return result.Outcome == ApprovalOutcome.Requested
            ? Accepted(new FixedAssetResult(result.Outcome, assetId, null, null, result.Request))
            : Ok(new FixedAssetResult(result.Outcome, assetId, await assets.CodeOfAsync(assetId, cancellationToken), result.Transaction, null));
    }

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;

    private bool CanApprove => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide);
}

// Applied: the asset is on the register (AssetCode), its payment made (Transaction, when paid).
// Requested: it waits for a manager (Request).
public sealed record FixedAssetResult(
    ApprovalOutcome Outcome, Guid AssetId, string? AssetCode, SafeTransactionDto? Transaction, ApprovalRequestDto? Request);

// AssetId and TransactionId are made by the till, with RequestId.
public sealed record AcquireFixedAssetRequest(
    Guid RequestId,
    Guid AssetId,
    Guid TransactionId,
    string Name,
    FixedAssetCategory Category,
    DateOnly PurchaseDate,
    decimal PurchaseCost,
    int UsefulLifeMonths,
    decimal SalvageValue = 0,
    string? Location = null,
    string? Notes = null,
    AssetPaymentSource PaidFrom = AssetPaymentSource.Safe,
    string? Reason = null);

// Cost and purchase date: an asset owned already's only.
public sealed record ChangeFixedAssetRequest(
    string Name,
    FixedAssetCategory Category,
    int UsefulLifeMonths,
    decimal SalvageValue = 0,
    string? Location = null,
    string? Notes = null,
    DateOnly? PurchaseDate = null,
    decimal? PurchaseCost = null);

// SaleProceeds more than nothing: sold, into the safe or the bank (Fund). Otherwise written off.
public sealed record DisposeFixedAssetRequest(
    Guid RequestId,
    Guid TransactionId,
    DateOnly Date,
    decimal? SaleProceeds = null,
    CashFund? Fund = null,
    string? Notes = null,
    string? Reason = null);
