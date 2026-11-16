using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Domain.Access;
using Costing.Domain.Recipes;
using Costing.Api.Auth;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// The manager's costing: what dishes and ingredients cost, and the food cost reports. Costs are
// a manager's, not a cashier's, so all of it is CostingView. Materials, purchases and recipes are
// changed through api/inventory, as before.
[ApiController]
[Route("api/costing")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class CostingController(
    CostingService costing, VarianceService variance, KpiService kpis, BreakEvenService breakEven, PurchaseSpendingService spending,
    TreasuryService treasury, StockCardService stockCard, IntelligenceService intelligence, BurdenedCostService burdened, DailyBreakEvenService dailyBreakEven,
    StaffMealsService staffMeals, MediatR.ISender sender,
    Costing.Application.Common.IBusinessCalendar calendar) : ControllerBase
{
    // Raw materials with their costs: what each costs per purchase unit, the last price paid, and
    // the stock's value.
    [HttpGet("materials")]
    [CostingTab(CostingTabs.Materials | CostingTabs.Recipes | CostingTabs.Purchases | CostingTabs.Counts | CostingTabs.Waste | CostingTabs.Production | CostingTabs.Reports)]
    public Task<IReadOnlyList<MaterialCostDto>> GetMaterials(CancellationToken cancellationToken) =>
        costing.GetMaterialsAsync(cancellationToken);

    // A material's purchase history card (كارت الصنف): each invoice line that bought it, to check
    // against the paper invoices.
    [HttpGet("materials/{materialId:guid}/purchases")]
    [CostingTab(CostingTabs.Materials | CostingTabs.Recipes | CostingTabs.Purchases | CostingTabs.Counts | CostingTabs.Waste | CostingTabs.Production | CostingTabs.Reports)]
    public Task<MaterialPurchaseHistory> GetMaterialPurchases(Guid materialId, CancellationToken cancellationToken) =>
        spending.MaterialHistoryAsync(materialId, cancellationToken);

    // A material's stock card (كارتة الصنف / حركة الصنف): every movement over the period, its running
    // balance and moving average, each with the record that made it; of one kind only when asked.
    [HttpGet("materials/{materialId:guid}/stock-card")]
    [CostingTab(StockCardTabs)]
    public Task<StockCard> GetStockCard(
        Guid materialId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] StockCardMovementType? type, CancellationToken cancellationToken) =>
        stockCard.GetAsync(materialId, from, to, type, cancellationToken);

    [HttpGet("materials/{materialId:guid}/stock-card/sheet")]
    [CostingTab(StockCardTabs)]
    public async Task<IActionResult> GetStockCardSheet(
        Guid materialId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] StockCardMovementType? type, CancellationToken cancellationToken)
    {
        var card = await stockCard.GetAsync(materialId, from, to, type, cancellationToken);
        return File(StockCardWorkbook.Build(card), ReportWorkbook.ContentType, $"stock-card-{card.Code ?? "material"}-{card.From:yyyy-MM-dd}-to-{card.To:yyyy-MM-dd}.xlsx");
    }

    // Wherever a material is shown with its stock or its price.
    private bool CanApprove => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide);

    private const CostingTabs StockCardTabs = CostingTabs.Materials | CostingTabs.Recipes | CostingTabs.Purchases | CostingTabs.Counts | CostingTabs.Waste
        | CostingTabs.Production | CostingTabs.Reports | CostingTabs.Intelligence;

    // A spot count's ready lists (جرد يومي سريع): the daily critical items, class A, the high
    // variance and each category, as material ids alone, for whoever starts a count.
    [HttpGet("count-presets")]
    [CostingTab(CostingTabs.Counts)]
    public Task<CountPresets> GetCountPresets(CancellationToken cancellationToken) => intelligence.GetCountPresetsAsync(cancellationToken);

    // Every dish, size and add-on with its cost per portion and food cost %.
    [HttpGet("menu")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu | CostingTabs.Reports)]
    public Task<IReadOnlyList<RecipeCostCard>> GetMenuCosts(CancellationToken cancellationToken) =>
        costing.GetMenuCostsAsync(cancellationToken);

    // The Recipe Costing Template for one dish, size or add-on.
    [HttpGet("recipe-card")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu | CostingTabs.Reports)]
    public Task<RecipeCostCard> GetRecipeCard(
        [FromQuery] RecipeTargetKind targetKind, [FromQuery] int catalogItemId, [FromQuery] int? variantId, CancellationToken cancellationToken) =>
        costing.GetRecipeCardAsync(targetKind, catalogItemId, variantId, cancellationToken);

    // Every recipe, on the menu or off it; the deleted ones too when asked for.
    [HttpGet("recipes")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu | CostingTabs.Reports)]
    public Task<IReadOnlyList<RecipeCostCard>> GetRecipes([FromQuery] bool includeDeleted, CancellationToken cancellationToken) =>
        costing.GetRecipesAsync(includeDeleted, cancellationToken);

    // The combo offers (العروض المجمعة) and what each costs, by its dishes, against its price.
    [HttpGet("combos")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu | CostingTabs.Reports)]
    public Task<ComboOffersReport> GetCombos([FromQuery] bool includeDeleted, CancellationToken cancellationToken) =>
        costing.GetComboOffersAsync(includeDeleted, cancellationToken);

    // One recipe's costing card, deleted or not.
    [HttpGet("recipes/{recipeId:guid}")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu | CostingTabs.Reports)]
    public Task<RecipeCostCard> GetRecipeCardById(Guid recipeId, CancellationToken cancellationToken) =>
        costing.GetRecipeCardAsync(recipeId, cancellationToken);

    // Where an item is used (أين تُستخدم الخامة): every recipe and prep item not deleted that has it,
    // on it or inside its prep items, how much a portion (a batch) takes and what it costs there.
    // For every tab that opens a stock card, where it is a tab of its own.
    [HttpGet("intelligence/where-used/{materialId:guid}")]
    [CostingTab(StockCardTabs)]
    public Task<WhereUsedReport> GetWhereUsed(Guid materialId, CancellationToken cancellationToken) =>
        costing.GetWhereUsedAsync(materialId, cancellationToken);

    // The bulk material swap (استبدال خامة شامل): what it would do, in memory, then done in one go.
    // Prep items are a manager's: anyone else's are shown, and left out.
    [HttpPost("recipes/bulk-swap/preview")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SwapPreview> PreviewBulkSwap(SwapPreviewRequest request, CancellationToken cancellationToken) =>
        costing.PreviewSwapAsync(request, CanApprove, cancellationToken);

    [HttpPost("recipes/bulk-swap")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<Costing.Application.Recipes.BulkSwapResult> BulkSwap(Costing.Application.Recipes.BulkSwapMaterialCommand command, CancellationToken cancellationToken) =>
        sender.Send(command with { CanApprove = CanApprove }, cancellationToken);

    // The vendor price matrix (مقارنة أسعار الموردين): each material bought in the period and every
    // supplier who sold it, net of every discount, the cheapest marked. Here, not on the intelligence
    // controller, so Purchases may read it too.
    [HttpGet("intelligence/vendor-prices")]
    [CostingTab(CostingTabs.Intelligence | CostingTabs.Purchases)]
    public Task<VendorPriceReport> GetVendorPrices([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        intelligence.GetVendorPricesAsync(from, to, cancellationToken);

    [HttpGet("intelligence/vendor-prices/sheet")]
    [CostingTab(CostingTabs.Intelligence | CostingTabs.Purchases)]
    public async Task<IActionResult> GetVendorPricesSheet([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        File(VendorPriceWorkbook.Build(await intelligence.GetVendorPricesAsync(from, to, cancellationToken)), ReportWorkbook.ContentType,
            $"vendor-prices-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");

    // The recipe's fully burdened plate (التكلفة الكلية شاملة التشغيل), for its card: its food, its
    // share of this month's labor and overheads so far, as the cost settings share them.
    [HttpGet("recipes/{recipeId:guid}/burdened")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu | CostingTabs.Reports | CostingTabs.Intelligence)]
    public Task<BurdenedRecipeCost> GetRecipeBurdenedCost(Guid recipeId, CancellationToken cancellationToken) =>
        burdened.GetForRecipeAsync(recipeId, cancellationToken);

    // The Monthly Theoretical Cost report for a business month: from the till's sales (Pos, the
    // default), or from the quantities typed in for it (Manual).
    [HttpGet("theoretical")]
    [CostingTab(CostingTabs.Reports | CostingTabs.Sales)]
    public Task<TheoreticalCostReport> GetTheoreticalCost(
        [FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken, [FromQuery] TheoreticalSource source = TheoreticalSource.Pos) =>
        costing.GetTheoreticalCostAsync(year, month, cancellationToken, source);

    // The month's sales sheet for typing quantities in: every active recipe and prep item.
    [HttpGet("manual-sales/{year:int}/{month:int}")]
    [CostingTab(CostingTabs.Reports | CostingTabs.Sales)]
    public Task<ManualSalesSheetDto> GetManualSales(int year, int month, CancellationToken cancellationToken) =>
        costing.GetManualSalesAsync(year, month, cancellationToken);

    // Saves the month's typed quantities, the whole sheet, and answers with the report from them.
    [HttpPut("manual-sales/{year:int}/{month:int}")]
    [CostingTab(CostingTabs.Reports | CostingTabs.Sales)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<TheoreticalCostReport> SaveManualSales(int year, int month, SaveManualSalesRequest request, CancellationToken cancellationToken) =>
        costing.SaveManualSalesAsync(year, month, request.Lines ?? [], User.FindFirst(UserClaims.Name)?.Value, cancellationToken);

    // Actual usage against standard between two posted stock counts; the last two by default.
    [HttpGet("variance")]
    [CostingTab(CostingTabs.Reports | CostingTabs.Counts)]
    public Task<VarianceReport> GetVariance([FromQuery] Guid? fromCountId, [FromQuery] Guid? toCountId, CancellationToken cancellationToken) =>
        variance.GetVarianceAsync(fromCountId, toCountId, cancellationToken);

    // Staff meals, hospitality and recipe tastings over the days: each entry, each day against the
    // daily staff meal budget, and the period's totals.
    [HttpGet("staff-meals")]
    [CostingTab(CostingTabs.Waste | CostingTabs.Reports)]
    public Task<StaffMealReport> GetStaffMeals([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        staffMeals.GetAsync(from, to, cancellationToken);

    // Spoilage recorded in the last so many days, with what it cost.
    [HttpGet("spoilage")]
    [CostingTab(CostingTabs.Waste | CostingTabs.Reports)]
    public Task<IReadOnlyList<SpoilageEntry>> GetSpoilage([FromQuery] int days = 30, CancellationToken cancellationToken = default)
    {
        var to = DateTime.UtcNow;
        return variance.GetSpoilageAsync(to.AddDays(-Math.Clamp(days, 1, 366)), to.AddMinutes(1), cancellationToken);
    }

    // Breakage (كسر) in the last so many business days: what was broken, at its cost, beside the
    // spoilage. Voided ones too, marked.
    [HttpGet("breakage")]
    [CostingTab(CostingTabs.Waste | CostingTabs.Reports)]
    public Task<IReadOnlyList<Costing.Application.Waste.BreakageEntryDto>> GetBreakage(
        [FromQuery] int days = 30, CancellationToken cancellationToken = default)
    {
        var today = calendar.BusinessDateOf(DateTime.UtcNow);
        return sender.Send(new Costing.Application.Waste.GetBreakageQuery(today.AddDays(-Math.Clamp(days, 1, 366) + 1), today), cancellationToken);
    }

    // The template's financial KPIs for a business month, with the month as an income statement
    // and what each dish earned.
    [HttpGet("kpis")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    public Task<KpiReport> GetKpis([FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken) =>
        kpis.GetAsync(year, month, cancellationToken);

    // The month's profit and loss (قائمة الدخل): gross profit, operating expenses, EBITDA, interest,
    // the fixed assets' depreciation and disposals, net profit. Read from the KPIs' statement.
    [HttpGet("reports/pnl")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    public async Task<ProfitAndLoss> GetProfitAndLoss([FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken) =>
        ProfitAndLoss.Of(await kpis.GetAsync(year, month, cancellationToken));

    // A month's wages, labour hours and overheads, as the manager enters them. The whole month
    // each time: a figure left out is not known yet.
    [HttpPut("expenses/{year:int}/{month:int}")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MonthlyExpensesDto> SaveExpenses(int year, int month, MonthlyExpensesDto expenses, CancellationToken cancellationToken) =>
        kpis.SaveExpensesAsync(year, month, expenses, User.FindFirst(UserClaims.Name)?.Value, cancellationToken);

    // Purchases by category between two days, both included: stock and expenses, from the posted invoices.
    [HttpGet("purchases/spending")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    public Task<SpendingReport> GetSpending([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        spending.GetAsync(from, to, cancellationToken);

    // The safe between two days, both included: where its money came from and went, the tax held
    // for the tax authority, and day by day.
    [HttpGet("treasury")]
    [CostingTab(CostingTabs.Reports | CostingTabs.Financials)]
    public Task<TreasuryAnalytics> GetTreasury([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetAnalyticsAsync(from, to, cancellationToken);

    // The break-even worksheet over a run of months (one month: from = to), at a year's pace.
    [HttpGet("break-even")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    public Task<BreakEvenWorksheet> GetBreakEven(
        [FromQuery] int fromYear, [FromQuery] int fromMonth, [FromQuery] int toYear, [FromQuery] int toMonth, CancellationToken cancellationToken) =>
        breakEven.GetAsync(fromYear, fromMonth, toYear, toMonth, cancellationToken);

    // The dynamic daily break-even (نقطة التعادل اليومية): a day's share of the month's fixed costs
    // against the contribution margin of what it sold, today unless another day is asked for.
    [HttpGet("reports/daily-break-even")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    public Task<DailyBreakEven> GetDailyBreakEven([FromQuery] DateOnly? date, CancellationToken cancellationToken) =>
        dailyBreakEven.GetAsync(date, cancellationToken);

    // The worksheet's four options, weekly sales to try, kept for next time.
    [HttpPut("break-even/scenarios")]
    [CostingTab(CostingTabs.Reports | CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<decimal>> SaveBreakEvenScenarios(IReadOnlyList<decimal> scenarios, CancellationToken cancellationToken) =>
        breakEven.SaveScenariosAsync(scenarios, cancellationToken);

    [HttpGet("settings")]
    [CostingTab(CostingTabs.All)]
    public Task<CostingSettingsDto> GetSettings(CancellationToken cancellationToken) =>
        costing.GetSettingsAsync(cancellationToken);

    [HttpPut("settings")]
    [CostingTab(CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<CostingSettingsDto> SaveSettings(CostingSettingsDto settings, CancellationToken cancellationToken) =>
        costing.SaveSettingsAsync(settings, cancellationToken);

    [HttpGet("shared-costs")]
    [CostingTab(CostingTabs.CostSettings | CostingTabs.Reports)]
    public Task<IReadOnlyList<SharedCostDto>> GetSharedCosts(CancellationToken cancellationToken) =>
        costing.GetSharedCostsAsync(cancellationToken);

    [HttpPost("shared-costs")]
    [CostingTab(CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SharedCostDto> AddSharedCost(SaveSharedCostRequest request, CancellationToken cancellationToken) =>
        costing.SaveSharedCostAsync(null, request, cancellationToken);

    [HttpPut("shared-costs/{id:guid}")]
    [CostingTab(CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SharedCostDto> SaveSharedCost(Guid id, SaveSharedCostRequest request, CancellationToken cancellationToken) =>
        costing.SaveSharedCostAsync(id, request, cancellationToken);

    [HttpDelete("shared-costs/{id:guid}")]
    [CostingTab(CostingTabs.CostSettings)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> DeleteSharedCost(Guid id, CancellationToken cancellationToken)
    {
        await costing.DeleteSharedCostAsync(id, cancellationToken);
        return NoContent();
    }
}

public sealed record SaveManualSalesRequest(IReadOnlyList<ManualSalesLineDto> Lines);
