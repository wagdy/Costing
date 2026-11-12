using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Domain.Access;
using Costing.Api.Auth;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// Material & demand intelligence (تحليلات الخامات والطلبيات): purchase price variance and what it does
// to the recipes, the order planner and its sheet, theoretical against actual consumption, and ABC
// with days on hand, and menu engineering. Each as a table, and as a workbook (…/sheet). Costs, so a manager's or a cost
// controller's view; nothing here changes anything.
[ApiController]
[Route("api/costing/intelligence")]
[Authorize(Policy = Permissions.InventoryView)]
[CostingTab(CostingTabs.Intelligence)]
public sealed class IntelligenceController(IntelligenceService intelligence, CostingService costing) : ControllerBase
{
    [HttpGet("prices")]
    public Task<PriceVarianceReport> GetPrices([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        intelligence.GetPriceVarianceAsync(from, to, cancellationToken);

    // As the screen filters it: one category, one supplier, the words typed.
    [HttpGet("prices/sheet")]
    public async Task<IActionResult> GetPricesSheet(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] Guid? categoryId, [FromQuery] Guid? supplierId, [FromQuery] string? search,
        CancellationToken cancellationToken)
    {
        var report = await intelligence.GetPriceVarianceAsync(from, to, cancellationToken);
        var words = (search ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var rows = report.Rows
            .Where(r => categoryId is null || r.CategoryId == categoryId)
            .Where(r => supplierId is null || r.SupplierIds.Contains(supplierId.Value))
            .Where(r => words.All(w => $"{r.Material} {r.Code}".Contains(w, StringComparison.OrdinalIgnoreCase)))
            .ToList();
        return File(IntelligenceWorkbooks.PriceVariance(report, rows), ReportWorkbook.ContentType, $"price-variance-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");
    }

    [HttpPost("orders")]
    public Task<OrderPlan> PlanOrder(OrderPlanRequest request, CancellationToken cancellationToken) =>
        intelligence.PlanOrderAsync(request, cancellationToken);

    // The order as approved, by category or by the supplier who sold each last.
    [HttpPost("orders/sheet")]
    public async Task<IActionResult> GetOrderSheet(OrderSheetRequest request, CancellationToken cancellationToken)
    {
        var sheet = await intelligence.OrderSheetAsync(request, cancellationToken);
        return File(IntelligenceWorkbooks.OrderSheet(sheet), ReportWorkbook.ContentType, $"order-{sheet.Today:yyyy-MM-dd}.xlsx");
    }

    [HttpGet("consumption")]
    public Task<ConsumptionReport> GetConsumption([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        intelligence.GetConsumptionAsync(from, to, cancellationToken);

    [HttpGet("consumption/sheet")]
    public async Task<IActionResult> GetConsumptionSheet([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        File(IntelligenceWorkbooks.Consumption(await intelligence.GetConsumptionAsync(from, to, cancellationToken)), ReportWorkbook.ContentType,
            $"consumption-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");

    [HttpGet("abc")]
    public Task<AbcReport> GetAbc([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        intelligence.GetAbcAsync(from, to, cancellationToken);

    [HttpGet("abc/sheet")]
    public async Task<IActionResult> GetAbcSheet([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        File(IntelligenceWorkbooks.Abc(await intelligence.GetAbcAsync(from, to, cancellationToken)), ReportWorkbook.ContentType,
            $"abc-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");

    // Menu engineering (هندسة المنيو والربحية): each dish sold in the period as a Star, a Plowhorse, a
    // Puzzle or a Dog, by its popularity and its contribution margin; in one menu category when asked.
    [HttpGet("menu-engineering")]
    public Task<MenuEngineeringReport> GetMenuEngineering(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] string? category, CancellationToken cancellationToken) =>
        costing.GetMenuEngineeringAsync(from, to, category, cancellationToken);

    [HttpGet("menu-engineering/sheet")]
    public async Task<IActionResult> GetMenuEngineeringSheet(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] string? category, CancellationToken cancellationToken) =>
        File(IntelligenceWorkbooks.MenuEngineering(await costing.GetMenuEngineeringAsync(from, to, category, cancellationToken)), ReportWorkbook.ContentType,
            $"menu-engineering-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");
}
