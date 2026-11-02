using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Domain.Access;
using Costing.Application.Approvals;
using Costing.Application.Treasury;
using Costing.Domain.Treasury;
using Costing.Api.Auth;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// The treasury (الماليات): the safe, where its money came from, each day's cash and its
// reconciliation with the sales, expense vouchers, and what is owed to suppliers and paid them.
// Whoever keeps the books sees and enters it; a safe entry by anyone who may not approve waits for
// a manager (202), and moves no cash until then. Voiding an entry is a deletion request
// (POST /api/inventory/deletion-requests, module Treasury). The tax and service settings are a
// manager's to change.
[ApiController]
[Route("api/financials")]
[Authorize(Policy = Permissions.InventoryManage)]
public sealed class FinancialsController(ISender sender, TreasuryService treasury) : ControllerBase
{
    // The till's business day: the date a safe entry is given unless another is chosen. Between
    // midnight and the hour the business day starts it is still yesterday.
    [HttpGet("today")]
    [CostingTab(CostingTabs.All)]
    public object GetToday() => new { Today = treasury.Today };

    [HttpGet("safe")]
    [CostingTab(CostingTabs.Financials)]
    public Task<SafeMonth> GetSafe([FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken) =>
        treasury.GetSafeAsync(year, month, cancellationToken);

    [HttpGet("funding")]
    [CostingTab(CostingTabs.Financials)]
    public Task<FundingReport> GetFunding([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetFundingAsync(from, to, cancellationToken);

    [HttpGet("revenue")]
    [CostingTab(CostingTabs.Financials)]
    public Task<DayRevenueReport> GetDayRevenue([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetDayRevenueAsync(from, to, cancellationToken);

    // Each day's cash before tax against the cash its sales should have brought in.
    [HttpGet("reconciliation")]
    [CostingTab(CostingTabs.Financials)]
    public Task<ReconciliationReport> GetReconciliation([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetReconciliationAsync(from, to, cancellationToken);

    // A day's takings before they are entered: what was paid out of them, which entering them takes off.
    [HttpGet("takings")]
    [CostingTab(CostingTabs.Financials)]
    public Task<TakingsPreview> GetTakingsPreview([FromQuery] DateOnly day, CancellationToken cancellationToken) =>
        treasury.GetTakingsPreviewAsync(day, cancellationToken);

    // Each day's takings as they were spent: the invoices paid out of them, and what reached the safe.
    [HttpGet("daily-cash")]
    [CostingTab(CostingTabs.Financials)]
    public Task<DailyCashReport> GetDailyCash([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetDailyCashAsync(from, to, cancellationToken);

    [HttpGet("settings")]
    [CostingTab(CostingTabs.Financials)]
    public Task<FinancialSettingsDto> GetSettings(CancellationToken cancellationToken) => treasury.GetSettingsAsync(cancellationToken);

    [HttpPut("settings")]
    [CostingTab(CostingTabs.Financials)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<FinancialSettingsDto> SaveSettings(SaveFinancialSettingsRequest request, CancellationToken cancellationToken) =>
        treasury.SaveSettingsAsync(request, StaffName, cancellationToken);

    [HttpGet("expense-vouchers")]
    [CostingTab(CostingTabs.Financials)]
    public Task<ExpenseVoucherReport> GetExpenseVouchers([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetExpenseVouchersAsync(from, to, cancellationToken);

    [HttpGet("suppliers")]
    [CostingTab(CostingTabs.Financials | CostingTabs.Purchases)]
    public Task<IReadOnlyList<SupplierBalance>> GetSupplierBalances(CancellationToken cancellationToken) =>
        treasury.GetSupplierBalancesAsync(cancellationToken);

    [HttpGet("suppliers/{supplierId:guid}")]
    [CostingTab(CostingTabs.Financials | CostingTabs.Purchases)]
    public async Task<ActionResult<SupplierStatement>> GetSupplierStatement(Guid supplierId, CancellationToken cancellationToken) =>
        await treasury.GetSupplierStatementAsync(supplierId, cancellationToken) is { } statement ? statement : NotFound();

    // Employees' advances (السلفيات) paid in a period, and the payroll month each is deducted in.
    // Salaries show here: whoever keeps the books may see them only with HR.
    [HttpGet("advances")]
    [CostingTab(CostingTabs.Financials)]
    public Task<IReadOnlyList<AdvanceRow>> GetAdvances([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetAdvancesAsync(from, to, cancellationToken);

    [HttpGet("supplier-payments")]
    [CostingTab(CostingTabs.Financials)]
    public Task<IReadOnlyList<SupplierPaymentRow>> GetSupplierPayments([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetSupplierPaymentsAsync(from, to, cancellationToken);

    // What a supplier was owed before the treasury: no cash moves, so it is entered at once.
    [HttpPost("suppliers/{supplierId:guid}/opening-balance")]
    [CostingTab(CostingTabs.Financials)]
    public async Task<IActionResult> SetSupplierOpeningBalance(Guid supplierId, SupplierOpeningBalanceRequest request, CancellationToken cancellationToken)
    {
        await sender.Send(new SetSupplierOpeningBalanceCommand(
            request.EntryId, supplierId, request.Owed, request.Date ?? treasury.Today, StaffName), cancellationToken);
        return NoContent();
    }

    // A safe entry: opening balance, funding, a day's takings moved in, an expense voucher, a
    // supplier payment, an employee's advance or their salary. Entered at once for a manager (200, the entry); asked of one for anyone
    // else (202, the request). RequestId and TransactionId are made by the till.
    [HttpPost("vouchers")]
    [CostingTab(CostingTabs.Financials | CostingTabs.Purchases)]
    public async Task<IActionResult> RecordVoucher(SafeVoucherRequest request, CancellationToken cancellationToken)
    {
        var result = await sender.Send(new RecordSafeVoucherCommand(
            request.RequestId,
            new SafeVoucher(
                request.TransactionId, request.Kind, request.Amount, request.Date ?? treasury.Today, request.Source, request.RevenueDate,
                request.SupplierId, request.ExpenseItemId, null, request.Notes, request.IncludesTax, EmployeeId: request.EmployeeId,
                PayrollMonth: request.PayrollMonth, CardAmount: request.CardAmount, TaxAmount: request.TaxAmount, VoidsAmount: request.VoidsAmount),
            request.Reason, UserClaims.IdOf(User) ?? string.Empty, StaffName, CanApprove), cancellationToken);
        return result.Outcome == ApprovalOutcome.Requested
            ? Accepted(new ApprovalResultDto(result.Outcome, result.Request!))
            : Ok(result.Transaction);
    }

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;

    private bool CanApprove => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide);
}

public sealed record SafeVoucherRequest(
    Guid RequestId,
    Guid TransactionId,
    SafeTransactionKind Kind,
    decimal Amount,
    DateOnly? Date = null,
    FundingSource? Source = null,
    DateOnly? RevenueDate = null,
    Guid? SupplierId = null,
    Guid? ExpenseItemId = null,
    string? Notes = null,
    string? Reason = null,
    // A day's takings counted with the tax in them: taken off at the till's own rate.
    bool IncludesTax = false,
    // An advance's or a salary's employee; a salary's payroll month (its first day).
    Guid? EmployeeId = null,
    DateOnly? PayrollMonth = null,
    // A day's takings from its Z report: Amount is the cash; these, its card takings, the tax
    // collected in both, and the day's voids and refunds.
    decimal? CardAmount = null,
    decimal? TaxAmount = null,
    decimal? VoidsAmount = null);

public sealed record SupplierOpeningBalanceRequest(Guid EntryId, decimal Owed, DateOnly? Date = null);
