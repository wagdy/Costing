using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Domain.Access;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// A supplier's account over a period (كشف حساب مورد تفصيلي): what was owed coming in, every credit
// and cash invoice and every payment with the balance after each, and what is owed going out; as a
// table, and as a workbook. From Purchases → Suppliers, Financials → Supplier debts and the AP aging.
[ApiController]
[Route("api/suppliers")]
[Authorize(Policy = Permissions.InventoryManage)]
[CostingTab(CostingTabs.Financials | CostingTabs.Purchases)]
public sealed class SuppliersController(SupplierAccountsService accounts) : ControllerBase
{
    // From the start of the year to today when the days are not given.
    [HttpGet("{supplierId:guid}/statement")]
    public async Task<ActionResult<SupplierAccount>> GetStatement(
        Guid supplierId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken) =>
        await accounts.GetAccountAsync(supplierId, from, to, cancellationToken) is { } account ? account : NotFound();

    [HttpGet("{supplierId:guid}/statement/sheet")]
    public async Task<IActionResult> GetStatementSheet(
        Guid supplierId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken) =>
        await accounts.GetAccountAsync(supplierId, from, to, cancellationToken) is { } account
            ? File(SupplierAccountWorkbook.Build(account), ReportWorkbook.ContentType,
                $"statement-{account.From:yyyy-MM-dd}-to-{account.To:yyyy-MM-dd}.xlsx")
            : NotFound();
}
