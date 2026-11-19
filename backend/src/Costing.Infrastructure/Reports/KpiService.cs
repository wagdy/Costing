using Microsoft.EntityFrameworkCore;
using Costing.Domain.Treasury;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.InterBranch;
using Costing.Application.Company;
using Costing.Domain.Sales;
using Costing.Domain.Categories;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

public enum KpiStatus
{
    // Within the template's healthy range.
    Healthy,
    Above,
    Below,

    // The template gives no range: it depends on the kind of restaurant.
    NoRange,

    // A figure it needs has not been entered (wages, hours) or does not exist (no drinks sold).
    Missing,
}

// One indicator of the template. Value is a percentage, or money for the average check and sales
// per labour hour. HighIsBad says which side of the range is the worry: above for a cost %,
// below for a margin.
public sealed record Kpi(string Key, decimal? Value, decimal? HealthyFrom, decimal? HealthyTo, bool HighIsBad, KpiStatus Status, string? Missing);

// The month as an income statement, the KPIs' ground. Revenue is the month's net sales: its takings
// as each day's Z report gave them, cash and card, less the tax collected in them, which is owed to
// the tax authority and never the restaurant's (Gross takings = Net sales + Tax). Split between
// food and drinks as the month's sales summaries are, at the menu's prices.
public sealed record MonthStatement(
    decimal FoodSales,
    decimal BeverageSales,
    decimal DeliveryFees,
    decimal Revenue,
    int PaidOrders,
    // What the sales took by their recipes, at cost when sold, shared costs such as frying oil included.
    decimal FoodRecipeCost,
    decimal BeverageRecipeCost,
    // Kitchen voids less refund returns, spoilage, and what counts found missing (or over).
    decimal KitchenWaste,
    decimal Spoilage,
    decimal CountDifferences,
    decimal CostOfSales,
    decimal GrossProfit,
    // As entered for the month: wages, and what is paid without a purchase invoice.
    decimal? WagesAndBenefits,
    decimal? OtherControllableCosts,
    decimal? OccupationCost,
    decimal? Interest,
    decimal? Depreciation,
    // Null until the wages are in: without them a net profit would flatter.
    decimal? NetProfit,
    // Expense items on the month's posted purchase invoices, on the line each category says,
    // added to what is entered above; and each category's part.
    decimal LoggedControllableCosts = 0,
    decimal LoggedOccupationCost = 0,
    decimal LoggedOtherFixedCosts = 0,
    IReadOnlyList<LoggedExpense>? LoggedExpenses = null,
    // Wages paid as expenses (vouchers, invoices under a Wages category) and the finalized payroll's
    // wages, added to the wages entered.
    decimal LoggedWages = 0,
    // Every overhead: wages, controllable, occupation, other fixed, interest and depreciation.
    decimal TotalExpenses = 0,
    // Consumable assets broken in the month (Costing → Waste's breakage), at their cost. Said, not
    // counted again: what they cost was counted when they were bought, as an expense.
    decimal Breakage = 0,
    // The month's takings: cash and card before tax, all that was collected with the tax on them, the
    // tax (a liability, not revenue), the voids and refunds said, and how many days' takings are entered.
    decimal CashTakings = 0,
    decimal CardTakings = 0,
    decimal GrossTakings = 0,
    decimal TaxCollected = 0,
    decimal Voids = 0,
    int TakingsDays = 0,
    // What the month's sales summaries come to at the menu's prices, before tax.
    decimal SalesAtMenuPrices = 0,
    // Taken from stock on purpose, at the cost then (وجبات العاملين والضيافة): staff meals, a benefit
    // of the staff, in the wages and benefits once the wages are known; hospitality and recipe
    // tastings, costs of their own in the total expenses. None of them is food cost or a loss.
    decimal StaffMeals = 0,
    decimal Hospitality = 0,
    decimal RecipeTasting = 0,
    // The P&L below the gross profit (ProfitAndLoss): what it costs to run the place, every overhead
    // but the interest and the depreciation; and what is left, EBITDA, null until the wages are in.
    decimal OperatingExpenses = 0,
    decimal? Ebitda = null,
    // The fixed assets register's straight-line depreciation for the month (FixedAssetService), on top
    // of any entered above; all of it; and the gains less the losses on the assets disposed of or sold
    // in the month, what they brought in less what was left of their cost.
    decimal AssetDepreciation = 0,
    decimal DepreciationExpense = 0,
    decimal DisposalGainOrLoss = 0,
    // With several branches (هيكلة الشركة): what a supplying branch sold the others on its internal
    // sales invoices, at their transfer prices, in its revenue, and what those goods cost it, in its
    // cost of sales; and what a receiving branch was billed for that never arrived, its transit
    // losses. A consolidated P&L has no sales between branches, and its transit losses are at what
    // the goods cost the company.
    decimal InterBranchSales = 0,
    decimal InterBranchCostOfGoods = 0,
    decimal TransitLosses = 0);

public sealed record MonthlyExpensesDto(
    decimal? WagesAndBenefits,
    decimal? LabourHours,
    decimal? OtherControllableCosts,
    decimal? OccupationCost,
    decimal? Interest,
    decimal? Depreciation,
    DateTime? UpdatedAtUtc = null,
    string? UpdatedBy = null);

// The template's item profitability: selling price − ingredient cost, over what was sold.
public sealed record ItemProfit(
    string ItemCode, string MenuItem, string? MenuItemAr, string Category, bool Beverage, decimal QuantitySold,
    decimal NetSales, decimal? Cost, decimal? Profit, decimal? ProfitPerUnit, decimal? MarginPercent);

public sealed record KpiReport(
    int Year,
    int Month,
    DateOnly From,
    DateOnly To,
    IReadOnlyList<string> BeverageCategories,
    MonthStatement Statement,
    MonthlyExpensesDto Expenses,
    IReadOnlyList<Kpi> Kpis,
    IReadOnlyList<ItemProfit> Items,
    // Sold with no recipe: in the sales at no ingredient cost, so the cost % reads low.
    int ItemsWithoutRecipe,
    decimal SalesWithoutRecipe,
    // What the month's discounts and promos did to the margin.
    DiscountImpact? Discounts = null,
    // Whose P&L it is, and with several branches what it is made of.
    PnlScope? Scope = null,
    InterBranchFigures? InterBranch = null,
    Eliminations? Eliminations = null,
    IReadOnlyList<PnlColumn>? Columns = null,
    CompanyCosts? CompanyCosts = null);

// Whose P&L (قائمة الدخل لـ): the company's while it has one branch; with several, one branch's
// (Branch), or the company's as a whole (Consolidated, الشركة ككل), its branches' added up with
// what they sold and bought from each other taken out. CanChoose: the one asking works every
// branch, and may read any of them or the whole. Branches: the ones to choose from.
public enum PnlView
{
    Company,
    Branch,
    Consolidated,
}

public sealed record PnlBranch(Guid Id, string Name, string? NameAr, BranchType Type, bool IsActive);

public sealed record PnlScope(PnlView View, Guid? BranchId, string? Branch, string? BranchAr, BranchType? BranchType, bool CanChoose, IReadOnlyList<PnlBranch> Branches);

// A branch's month with the other branches (مع الفروع الأخرى): as a supplying branch, its internal
// sales invoices dispatched in the month (Sales, at the transfer prices; CostOfGoodsSent, what the
// goods cost it; Margin, the difference); as a receiving branch, its internal purchase invoices
// received in the month (Purchases, what it was billed, into its stock but for TransitLosses, what
// never arrived). Voided ones are not counted.
public sealed record InterBranchFigures(
    decimal Sales, decimal CostOfGoodsSent, decimal Margin, int Shipments, decimal Purchases, decimal TransitLosses, int Receipts);

// What the consolidated P&L takes out of its branches' P&Ls added up (الاستبعادات بين الفروع), so
// nothing is counted twice:
//
//   Inter-branch sales      the supplying branches' internal sales, out of the revenue
//   Inter-branch purchases  the same goods' cost, out of the costs:
//     Cost of goods sent      what they cost the supplying branch (its cost of goods sent)
//     Markup in cost of sales the markup the receiving branches paid on what they sold, lost, or
//                             never received this month, at their transfer prices
//     Markup in expenses      and on what their staff ate or guests were given
//
// Markup still on a branch's shelves, or on the road, is in no P&L until the goods are used.
// GrossProfit: what the eliminations do to the gross profit (+ adds to it, − takes from it).
public sealed record Eliminations(
    decimal InterBranchSales,
    decimal CostOfGoodsSent,
    decimal MarkupInCostOfSales,
    decimal MarkupInExpenses,
    decimal InterBranchPurchases,
    decimal GrossProfit);

// What the company has that no branch keeps (مصروفات على مستوى الشركة): the month's payroll from HR
// (Payroll, null without one), the fixed assets register's depreciation, and the gains less the
// losses on assets disposed of. On the company's P&L; said on a branch's, never counted there.
public sealed record CompanyCosts(decimal? Payroll, decimal AssetDepreciation, decimal DisposalGainOrLoss);

// One column of the consolidated P&L's table by branch: each branch's own, the company's costs,
// the eliminations, and the consolidated, which the others add up to. EBITDA and the net profit
// are null for a branch whose wages are not in.
public enum PnlColumnKind
{
    Branch,
    CompanyCosts,
    Eliminations,
    Consolidated,
}

public sealed record PnlColumn(
    PnlColumnKind Kind, Guid? BranchId, string Name, string? NameAr, decimal Revenue, decimal CostOfSales, decimal GrossProfit,
    decimal OperatingExpenses, decimal? Ebitda, decimal? NetProfit);

// Promos and discounts against the margin (أثر الخصومات وتآكل الهامش), from the month's takings:
//
//   Standard gross revenue = net sales + discounts        (what the menu prices would have brought)
//   Actual net revenue     = net sales                    (the cash and card collected, before tax)
//   Standard food cost %   = theoretical cost ÷ standard gross revenue × 100
//   Actual food cost %     = theoretical cost ÷ actual net revenue × 100
//   Margin erosion         = actual food cost % − standard food cost %, in points
//
// The theoretical cost is the recipes' cost of what was sold (food and drinks). Reasons: each with
// what it took off and on how many bills, the largest first; a voided day's taken back out.
public sealed record DiscountImpact(
    decimal Discounts,
    decimal ActualNetRevenue,
    decimal StandardGrossRevenue,
    decimal? DiscountSharePercent,
    decimal TheoreticalCost,
    decimal? StandardFoodCostPercent,
    decimal? ActualFoodCostPercent,
    decimal? ErosionPoints,
    IReadOnlyList<DiscountReason> Reasons);

// Pillar 4: the template's financial KPIs for a business month. Sales and recipe costs come
// from the till; losses from the stock ledger; wages, hours and overheads from what the manager
// enters for the month. With several branches, one branch's (its own records, at its own costs)
// or the company's as a whole, consolidated: its branches' added up, with their sales to and
// purchases from each other taken out and the company's own costs added.
public sealed class KpiService(
    CostingDbContext db, IBusinessCalendar clock, CostingService costing, SalesLedger ledger, PurchaseSpendingService spending, FixedAssetService fixedAssets,
    Costing.Application.Books.BooksGuard books, ICompanyProfile profile, IBranchRequest asking)
{
    // The template's healthy ranges.
    private static readonly (decimal From, decimal To) FoodCostRange = (28, 35);
    private static readonly (decimal From, decimal To) BeverageCostRange = (20, 25);
    private static readonly (decimal From, decimal To) LabourCostRange = (25, 35);
    private static readonly (decimal From, decimal To) GrossMarginRange = (60, 70);
    private static readonly (decimal From, decimal To) NetMarginRange = (5, 15);

    private static readonly StockMovementReason[] Losses =
        [StockMovementReason.Waste, StockMovementReason.VoidReturn, StockMovementReason.Spoilage, StockMovementReason.CountAdjustment];

    // Whose P&L the one asking reads: the company's while it has one branch. With several, a user
    // kept to a branch reads their own branch's, whatever is asked; one who works every branch the
    // branch asked for, or, none asked, the company's as a whole.
    public async Task<Guid?> BranchToReadAsync(Guid? asked, CancellationToken cancellationToken)
    {
        if (!profile.Current.OperatingMode.IsMultiBranch())
            return null;
        if (asking.AssignedBranchId is { } own)
        {
            if (asked is { } other && other != own)
                throw new ForbiddenException("Only your own branch's P&L is yours to read. · قائمة دخل فرعك فقط.");
            return own;
        }
        if (asked is { } id && !await db.Branches.AsNoTracking().AnyAsync(b => b.Id == id, cancellationToken))
            throw new NotFoundException(nameof(Branch), id);
        return asked;
    }

    // Whose monthly costs are saved: the first branch's while there is one; with several, the
    // branch of the P&L they are entered on, never the company's as a whole.
    public async Task<Guid> BranchToEnterAsync(Guid? asked, CancellationToken cancellationToken) =>
        !profile.Current.OperatingMode.IsMultiBranch() ? Branch.DefaultId
        : await BranchToReadAsync(asked, cancellationToken)
            ?? throw new DomainException("Choose the branch these costs are for: each branch's are entered on its own P&L. · اختر الفرع.");

    // The month's KPIs and P&L: the company's (branchId null), consolidated once it has several
    // branches; or, with several, the branch's.
    public async Task<KpiReport> GetAsync(int year, int month, CancellationToken cancellationToken, Guid? branchId = null)
    {
        if (month is < 1 or > 12 || year is < 2000 or > 2100)
            throw new DomainException("Choose a month.");
        var multi = profile.Current.OperatingMode.IsMultiBranch();
        if (!multi)
            branchId = null;
        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var beverages = settings.BeverageCategories.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var branches = await db.Branches.AsNoTracking().OrderByDescending(b => b.Id == Branch.DefaultId).ThenBy(b => b.Name).ToListAsync(cancellationToken);
        var company = await CompanyCostsAsync(year, month, cancellationToken);
        var choices = branches.Where(b => b.IsActive).Select(b => new PnlBranch(b.Id, b.Name, b.NameAr, b.Type, b.IsActive)).ToList();
        var canChoose = multi && asking.AssignedBranchId is null;

        if (branchId is { } id)
        {
            var branch = branches.SingleOrDefault(b => b.Id == id) ?? throw new NotFoundException(nameof(Branch), id);
            var figures = await FiguresAsync(year, month, id, beverages, company.Payroll is not null, cancellationToken);
            return Report(figures, settings, beverages, null, company.Payroll is not null) with
            {
                Scope = new PnlScope(PnlView.Branch, id, branch.Name, branch.NameAr, branch.Type, canChoose, choices),
                InterBranch = new InterBranchFigures(
                    figures.InterBranchSales, figures.CostOfGoodsSent, Money(figures.InterBranchSales - figures.CostOfGoodsSent), figures.Shipments,
                    figures.InterBranchPurchases, figures.TransitLosses, figures.Receipts),
                CompanyCosts = company,
            };
        }

        if (!multi)
        {
            // One branch: the company's, as it always was; anything left between branches from a
            // structure it had before, taken out as the consolidated P&L takes it.
            var whole = await FiguresAsync(year, month, null, beverages, company.Payroll is not null, cancellationToken);
            var left = Eliminate([whole]);
            return Report(whole.AtCompanyCost(), settings, beverages, company, company.Payroll is not null) with
            {
                Scope = new PnlScope(PnlView.Company, null, null, null, null, false, []),
                Eliminations = left.InterBranchSales != 0 || left.InterBranchPurchases != 0 ? left : null,
            };
        }

        // Each branch's own, at its own costs; the company's, theirs at what they cost the company,
        // with its own costs; the dishes as the company sold them.
        var each = new List<(Branch Branch, Figures Figures, KpiReport Report)>();
        foreach (var branch in branches)
        {
            var figures = await FiguresAsync(year, month, branch.Id, beverages, company.Payroll is not null, cancellationToken);
            if (branch.IsActive || figures.HasAny)
                each.Add((branch, figures, Report(figures, settings, beverages, null, company.Payroll is not null)));
        }
        var sold = (await costing.GetTheoreticalCostAsync(year, month, cancellationToken)).Rows
            .Select(r => r with { TheoreticalCost = r.TheoreticalCost - r.InternalMarkup, InternalMarkup = 0 })
            .ToList();
        var consolidated = Figures.Sum(each.Select(e => e.Figures.AtCompanyCost()).ToList()) with { Rows = sold };
        var eliminations = Eliminate(each.Select(e => e.Figures).ToList());
        // The company's wages are in once every branch that traded has its own in: one without
        // would flatter the whole.
        var withoutWages = each.Where(e => e.Figures.HasAny && e.Report.Statement.Ebitda is null).Select(e => e.Branch.Name).ToList();
        var report = Report(consolidated, settings, beverages, company, company.Payroll is not null, withoutWages);

        var columns = each.Select(e => Column(PnlColumnKind.Branch, e.Branch.Id, e.Branch.Name, e.Branch.NameAr, e.Report.Statement)).ToList();
        var companyNet = -(company.Payroll ?? 0) - company.AssetDepreciation + company.DisposalGainOrLoss;
        columns.Add(new PnlColumn(PnlColumnKind.CompanyCosts, null, "Company costs", "مصروفات الشركة", 0, 0, 0, company.Payroll ?? 0,
            -(company.Payroll ?? 0), Money(companyNet)));
        columns.Add(new PnlColumn(PnlColumnKind.Eliminations, null, "Eliminations", "الاستبعادات", -eliminations.InterBranchSales,
            -(eliminations.CostOfGoodsSent + eliminations.MarkupInCostOfSales), eliminations.GrossProfit, -eliminations.MarkupInExpenses,
            Money(eliminations.GrossProfit + eliminations.MarkupInExpenses), Money(eliminations.GrossProfit + eliminations.MarkupInExpenses)));
        columns.Add(Column(PnlColumnKind.Consolidated, null, "Consolidated", "الشركة ككل", report.Statement));

        return report with
        {
            Scope = new PnlScope(PnlView.Consolidated, null, null, null, null, canChoose, choices),
            Eliminations = eliminations,
            Columns = columns,
            CompanyCosts = company,
        };
    }

    private static PnlColumn Column(PnlColumnKind kind, Guid? id, string name, string? nameAr, MonthStatement s) =>
        new(kind, id, name, nameAr, s.Revenue, s.CostOfSales, s.GrossProfit, s.OperatingExpenses, s.Ebitda, s.NetProfit);

    // What the branches sold and bought each other, taken out of their sum (Eliminations).
    private static Eliminations Eliminate(IReadOnlyList<Figures> branches)
    {
        var sales = Money(branches.Sum(b => b.InterBranchSales));
        var sent = Money(branches.Sum(b => b.CostOfGoodsSent));
        var inCostOfSales = Money(branches.Sum(b => b.MarkupInCostOfSales));
        var inExpenses = Money(branches.Sum(b => b.MarkupInExpenses));
        return new Eliminations(sales, sent, inCostOfSales, inExpenses, Money(sent + inCostOfSales + inExpenses), Money(sent + inCostOfSales - sales));
    }

    // The month's payroll from HR, when HR sent one (its labor cost: the wages and what was added,
    // less the penalties, whether paid yet or not); the fixed assets register's month.
    private async Task<CompanyCosts> CompanyCostsAsync(int year, int month, CancellationToken cancellationToken)
    {
        var first = new DateOnly(year, month, 1);
        var payroll = await db.PayrollRuns.AsNoTracking().Where(r => r.Period == first).Select(r => (decimal?)r.LaborCost).SingleOrDefaultAsync(cancellationToken);
        var assets = await fixedAssets.MonthAsync(first, cancellationToken);
        return new CompanyCosts(Money(payroll), assets.Depreciation, assets.DisposalGainOrLoss);
    }

    // Everything the month's P&L is made of, for one branch (its own records) or the whole company
    // (branchId null), at the branch's costs, with the markup paid to another branch in each.
    private async Task<Figures> FiguresAsync(
        int year, int month, Guid? branchId, IReadOnlySet<string> beverages, bool payrollFromHr, CancellationToken cancellationToken)
    {
        bool IsBeverage(string? category) => category is not null && beverages.Contains(category);
        // Checks the month, and gives what each dish sold and what its recipes cost.
        var theoretical = await costing.GetTheoreticalCostAsync(year, month, cancellationToken, branchId: branchId);
        var (from, _) = clock.Bounds(theoretical.From);
        var (_, to) = clock.Bounds(theoretical.To);

        // What was sold, at the menu's prices (a bill entered as printed: what it charged), less each
        // bill's promo discount shared over its lines by value, before VAT: how the revenue is
        // split between food and drinks.
        var orders = await ledger.GetAsync(from, to, cancellationToken, branchId);
        var categoryOf = await db.MenuItems.AsNoTracking().IgnoreQueryFilters()
            .ToDictionaryAsync(m => m.Id, m => m.Category, cancellationToken);
        decimal food = 0, drinks = 0, deliveryFees = 0;
        var paidOrders = 0;
        foreach (var order in orders)
        {
            var lines = order.Lines.Where(l => l.OnBill).ToList();
            if (lines.Count == 0)
                continue;
            paidOrders++;
            var billed = order.BilledSubtotal;
            var kept = billed > 0 ? 1 - Math.Min(order.DiscountAmount, billed) / billed : 1;
            foreach (var line in lines)
            {
                var revenue = line.LineTotal * kept;
                if (IsBeverage(categoryOf.GetValueOrDefault(line.MenuItemId)))
                    drinks += revenue;
                else
                    food += revenue;
            }
            deliveryFees += order.DeliveryFee;
        }
        var soldAtMenuPrices = food + drinks + deliveryFees;

        // Revenue: the month's net sales, the cash and card each day's Z report gave before the tax
        // collected on them, which is owed, never revenue. A voided day nets out with its reversal.
        var takings = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.RevenueTransfer && t.RevenueDate >= theoretical.From && t.RevenueDate <= theoretical.To)
            .Where(t => branchId == null || t.BranchId == branchId)
            .ToListAsync(cancellationToken);
        var revenueTotal = takings.Sum(t => t.NetAmount);
        (food, drinks) = food + drinks > 0
            ? (revenueTotal * food / (food + drinks), revenueTotal - revenueTotal * food / (food + drinks))
            : (revenueTotal, 0m);

        // Losses from the ledger, valued at the cost when each happened, and at what that cost the
        // company. Shared-cost materials are left out: their month is already in the recipe cost,
        // as the shared cost per meal. Staff meals, hospitality and tastings alike.
        var sharedMaterials = await db.SharedCosts.AsNoTracking()
            .Where(c => c.RawMaterialId != null).Select(c => c.RawMaterialId!.Value).ToListAsync(cancellationToken);
        var taken = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc >= from && m.OccurredAtUtc < to && m.UnitCost != null
                && ((Losses.Contains(m.Reason) && !sharedMaterials.Contains(m.RawMaterialId)) || StaffConsumption.Reasons.Contains(m.Reason)))
            .Where(m => branchId == null || m.BranchId == branchId)
            .GroupBy(m => m.Reason)
            .Select(g => new
            {
                Reason = g.Key,
                Value = g.Sum(m => -m.Quantity * m.UnitCost!.Value),
                Markup = g.Sum(m => m.CompanyUnitCost == null ? 0 : -m.Quantity * (m.UnitCost!.Value - m.CompanyUnitCost.Value)),
            })
            .ToListAsync(cancellationToken);
        (decimal Value, decimal Markup) Taken(params StockMovementReason[] reasons) =>
            (Money(taken.Where(l => reasons.Contains(l.Reason)).Sum(l => l.Value)), Money(taken.Where(l => reasons.Contains(l.Reason)).Sum(l => l.Markup)));

        // What was entered for the month: the branch's, or every branch's added up.
        var entered = await db.MonthlyExpenses.AsNoTracking()
            .Where(e => e.Year == year && e.Month == month && (branchId == null || e.BranchId == branchId))
            .ToListAsync(cancellationToken);
        // The month's expense invoices and vouchers, on top of what is entered: an electricity bill
        // logged as a purchase, or salaries paid by voucher, are not typed in again.
        var logged = await spending.LoggedExpensesAsync(theoretical.From, theoretical.To, cancellationToken, branchId);
        // Salaries paid from the safe (صرف راتب), by the payroll month they are for, a voided one
        // netted out by its reversal, unless HR sent the month's payroll: then they paid it, and it
        // is counted as the company's. Advances are settled against pay, not counted again.
        var payrollMonth = new DateOnly(year, month, 1);
        var salaries = payrollFromHr ? 0 : Money(-await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.SalaryPayment && t.PayrollMonth == payrollMonth)
            .Where(t => branchId == null || t.BranchId == branchId)
            .SumAsync(t => t.Amount, cancellationToken));
        var breakage = Money(await db.BreakageEntries.AsNoTracking()
            .Where(b => b.BusinessDate >= theoretical.From && b.BusinessDate <= theoretical.To && b.VoidedAtUtc == null)
            .Where(b => branchId == null || b.BranchId == branchId)
            .SumAsync(b => b.Cost, cancellationToken));

        // The branch's dealings with the others: its internal sales invoices dispatched in the month,
        // and its internal purchase invoices received, with what never arrived on them, at the
        // price billed and at what it cost the company (the sending branch's cost as it left).
        var sent = await db.InternalSalesInvoices.AsNoTracking()
            .Where(i => i.Status != ShipmentStatus.Voided && i.DispatchDate >= theoretical.From && i.DispatchDate <= theoretical.To)
            .Where(i => branchId == null || i.BranchId == branchId)
            .Select(i => new { i.TotalTransferRevenue, i.TotalInternalCogs })
            .ToListAsync(cancellationToken);
        var received = await db.InternalPurchaseInvoices.AsNoTracking().Include(i => i.Lines)
            .Where(i => i.Status == InternalPurchaseInvoiceStatus.Posted && i.ReceiptDate >= theoretical.From && i.ReceiptDate <= theoretical.To)
            .Where(i => branchId == null || i.BranchId == branchId)
            .ToListAsync(cancellationToken);
        var shorted = received.Where(i => i.TotalTransitLoss != 0).Select(i => i.InternalSalesInvoiceId).ToList();
        var sentAt = (await db.StockMovements.AsNoTracking()
                .Where(m => m.Reason == StockMovementReason.InterBranchDispatchOut && m.ReversalOf == null && shorted.Contains(m.SourceId))
                .Select(m => new { m.SourceId, m.RawMaterialId, m.UnitCost, m.CompanyUnitCost })
                .ToListAsync(cancellationToken))
            .GroupBy(m => (m.SourceId, m.RawMaterialId))
            .ToDictionary(g => g.Key, g => g.First().CompanyUnitCost ?? g.First().UnitCost);
        var transitMarkup = received
            .SelectMany(i => i.Lines.Where(l => l.ShortQuantity > 0)
                .Select(l => sentAt.GetValueOrDefault((i.InternalSalesInvoiceId, l.RawMaterialId)) is { } cost ? l.TransitLoss - l.ShortQuantity * cost : 0))
            .Sum();

        var (waste, wasteMarkup) = Taken(StockMovementReason.Waste, StockMovementReason.VoidReturn);
        var (spoilage, spoilageMarkup) = Taken(StockMovementReason.Spoilage);
        var (counts, countsMarkup) = Taken(StockMovementReason.CountAdjustment);
        var (staffMeals, staffMealsMarkup) = Taken(StockMovementReason.StaffMeal);
        var (hospitality, hospitalityMarkup) = Taken(StockMovementReason.Hospitality);
        var (tasting, tastingMarkup) = Taken(StockMovementReason.RecipeTasting);
        return new Figures
        {
            Year = year, Month = month, From = theoretical.From, To = theoretical.To,
            Food = food, Drinks = drinks, PaidOrders = paidOrders, SoldAtMenuPrices = soldAtMenuPrices, Takings = takings,
            Rows = theoretical.Rows,
            FoodRecipe = theoretical.Rows.Where(r => !IsBeverage(r.Category)).Sum(r => r.TheoreticalCost),
            DrinksRecipe = theoretical.Rows.Where(r => IsBeverage(r.Category)).Sum(r => r.TheoreticalCost),
            FoodMarkup = theoretical.Rows.Where(r => !IsBeverage(r.Category)).Sum(r => r.InternalMarkup),
            DrinksMarkup = theoretical.Rows.Where(r => IsBeverage(r.Category)).Sum(r => r.InternalMarkup),
            KitchenWaste = waste, Spoilage = spoilage, CountDifferences = counts,
            WasteMarkup = wasteMarkup, SpoilageMarkup = spoilageMarkup, CountsMarkup = countsMarkup,
            StaffMeals = staffMeals, Hospitality = hospitality, RecipeTasting = tasting,
            StaffMealsMarkup = staffMealsMarkup, HospitalityMarkup = hospitalityMarkup, TastingMarkup = tastingMarkup,
            Entered = entered, Logged = logged, Salaries = salaries, Breakage = breakage,
            InterBranchSales = Money(sent.Sum(i => i.TotalTransferRevenue)), CostOfGoodsSent = Money(sent.Sum(i => i.TotalInternalCogs)), Shipments = sent.Count,
            InterBranchPurchases = Money(received.Sum(i => i.TotalBilled)), TransitLosses = Money(received.Sum(i => i.TotalTransitLoss)),
            TransitMarkup = Money(transitMarkup), Receipts = received.Count,
        };
    }

    // The report from the month's figures. Company: its own costs, added (the company's P&L), or
    // null (a branch's, which has none). PayrollFromHr: the month's wages are in HR's payroll.
    // WithoutWages: the branches whose wages are not in yet, for the company's.
    private static KpiReport Report(
        Figures f, CostingSettings settings, IReadOnlySet<string> beverages, CompanyCosts? company, bool payrollFromHr,
        IReadOnlyList<string>? withoutWages = null)
    {
        var expenses = MonthlyExpenses.Combined(f.Entered);
        var revenueTotal = f.Takings.Sum(t => t.NetAmount);
        var revenue = revenueTotal + f.InterBranchSales;
        var takingsDays = f.Takings.Where(t => !t.IsReversal && !t.IsVoided).Select(t => t.RevenueDate).Distinct().Count();
        var noTakings = revenue == 0 ? "Enter the month's takings on Financials. · أدخل إيراد الشهر في الماليات." : null;

        var lossTotal = f.KitchenWaste + f.Spoilage + f.CountDifferences;
        var costOfSales = f.FoodRecipe + f.DrinksRecipe + lossTotal + f.CostOfGoodsSent + f.TransitLosses;
        var grossProfit = revenue - costOfSales;

        decimal Logged(ExpenseLine line) => Money(f.Logged.Where(e => e.ExpenseLine == line).Sum(e => e.Amount));
        var (loggedControllable, loggedOccupation, loggedOtherFixed) = (Logged(ExpenseLine.Controllable), Logged(ExpenseLine.Occupation), Logged(ExpenseLine.OtherFixed));
        // Wages paid as expenses (vouchers, invoices under a Wages category), and the salaries paid
        // or, the company's, the payroll HR approved for the month.
        var loggedWages = Logged(ExpenseLine.Wages) + f.Salaries + (company?.Payroll ?? 0);

        // Known once entered or paid: wages as entered plus wages paid as expenses, with the staff's
        // meals. A branch's are known too when the month's payroll came from HR, the company's.
        var branchesMissing = !payrollFromHr && withoutWages is { Count: > 0 } ? withoutWages : null;
        var wagesKnown = (expenses?.WagesAndBenefits is not null || loggedWages != 0 || (company is null && payrollFromHr)) && branchesMissing is null;
        var enterWages = branchesMissing is null ? "Enter the month's wages and benefits."
            : branchesMissing.Count == 1 ? $"Enter {branchesMissing[0]}'s wages and benefits on its own P&L. · أدخل رواتب الفرع."
            : $"Enter the wages and benefits of {Names(branchesMissing)}, each on its own P&L. · أدخل رواتب كل فرع.";
        decimal? wages = wagesKnown ? (expenses?.WagesAndBenefits ?? 0) + loggedWages + f.StaffMeals : null;
        // Gross profit − operating expenses = EBITDA; − interest − depreciation ± disposals = net profit.
        // A fixed asset bought is never an operating expense: its cost left the safe or the bank, and
        // comes here a month at a time as depreciation (FixedAsset).
        // While a branch's wages are missing from the company's, those entered are counted all the
        // same, so its operating expenses are its branches' added up; EBITDA waits.
        var wagesSoFar = wages ?? (branchesMissing is null ? 0 : (expenses?.WagesAndBenefits ?? 0) + loggedWages + f.StaffMeals);
        var operating = wagesSoFar + (expenses?.OtherControllableCosts ?? 0) + (expenses?.OccupationCost ?? 0)
            + loggedControllable + loggedOccupation + loggedOtherFixed + f.Hospitality + f.RecipeTasting;
        var assetDepreciation = company?.AssetDepreciation ?? 0;
        var disposals = company?.DisposalGainOrLoss ?? 0;
        var depreciation = (expenses?.Depreciation ?? 0) + assetDepreciation;
        var totalExpenses = operating + (expenses?.Interest ?? 0) + depreciation;
        decimal? ebitda = wages is not null ? grossProfit - operating : null;
        decimal? netProfit = ebitda is { } e ? e - (expenses?.Interest ?? 0) - depreciation + disposals : null;

        var food = f.Food + f.InterBranchSales;
        decimal? Share(decimal part, decimal whole) => whole > 0 ? Percent(part / whole) : null;
        var kpis = new List<Kpi>
        {
            // Losses are counted against food: the stock they come from is mostly the kitchen's; so
            // are what a central kitchen sends the branches, and what never reached them.
            Ranged("FoodCost", Share(f.FoodRecipe + lossTotal + f.CostOfGoodsSent + f.TransitLosses, food), FoodCostRange, highIsBad: true,
                noTakings ?? (food > 0 ? null : "No food was sold this month.")),
            Ranged("BeverageCost", Share(f.DrinksRecipe, f.Drinks), BeverageCostRange, highIsBad: true,
                beverages.Count == 0 ? "Mark the drinks categories in Settings." : noTakings ?? (f.Drinks > 0 ? null : "No drinks were sold this month.")),
            Ranged("LabourCost", wages is { } wage ? Share(wage, revenue) : null, LabourCostRange, highIsBad: true,
                wages is null ? enterWages
                : company is null && payrollFromHr && expenses?.WagesAndBenefits is null && loggedWages == 0
                    ? "The month's payroll from HR is the company's: on the consolidated P&L. · الرواتب على مستوى الشركة."
                    : noTakings),
            // Sales are entered as each day's totals: there are no bills to average.
            Unranged("AverageCheck", null, "Sales are entered as daily totals, not bills. · المبيعات تُسجل إجماليًا يوميًا."),
            Unranged("SalesPerLabourHour", expenses?.LabourHours is > 0 and var hours ? Money(revenue / hours) : null,
                expenses?.LabourHours is > 0 ? null : "Enter the month's labour hours."),
            Ranged("GrossProfitMargin", Share(grossProfit, revenue), GrossMarginRange, highIsBad: false, noTakings),
            Ranged("NetProfitMargin", netProfit is { } net ? Share(net, revenue) : null, NetMarginRange, highIsBad: false,
                wages is null ? branchesMissing is null ? "Enter the month's wages and overheads." : enterWages : null),
        };

        bool IsBeverage(string? category) => category is not null && beverages.Contains(category);
        var items = f.Rows
            .Select(r =>
            {
                var costed = r.Status != CostStatus.NoRecipe;
                decimal? profit = costed ? r.NetSales - r.TheoreticalCost : null;
                return new ItemProfit(
                    r.ItemCode, r.MenuItem, r.MenuItemAr, r.Category, IsBeverage(r.Category), r.QuantitySold, r.NetSales,
                    costed ? r.TheoreticalCost : null, profit, profit is { } p && r.QuantitySold > 0 ? Money(p / r.QuantitySold) : null,
                    profit is { } q && r.NetSales > 0 ? Percent(q / r.NetSales) : null);
            })
            .OrderByDescending(i => i.Profit ?? decimal.MinValue)
            .ThenByDescending(i => i.NetSales)
            .ToList();
        var withoutRecipe = f.Rows.Where(r => r.Status == CostStatus.NoRecipe).ToList();

        var t = f.Takings;
        return new KpiReport(
            f.Year, f.Month, f.From, f.To, settings.BeverageCategories,
            new MonthStatement(
                Money(f.Food), Money(f.Drinks), 0, Money(revenue), f.PaidOrders,
                Money(f.FoodRecipe), Money(f.DrinksRecipe), f.KitchenWaste, f.Spoilage, f.CountDifferences,
                Money(costOfSales), Money(grossProfit),
                expenses?.WagesAndBenefits, expenses?.OtherControllableCosts, expenses?.OccupationCost, expenses?.Interest, expenses?.Depreciation,
                Money(netProfit), loggedControllable, loggedOccupation, loggedOtherFixed, f.Logged, loggedWages, Money(totalExpenses), f.Breakage,
                Money(t.Sum(x => x.GrossAmount ?? x.Amount)), Money(t.Sum(x => x.CardAmount)), Money(t.Sum(x => x.TakingsTotal)),
                Money(t.Sum(x => x.TaxAmount)), Money(t.Sum(x => x.VoidsAmount)),
                takingsDays, Money(f.SoldAtMenuPrices), f.StaffMeals, f.Hospitality, f.RecipeTasting,
                Money(operating), Money(ebitda), assetDepreciation, Money(depreciation), disposals,
                Money(f.InterBranchSales), Money(f.CostOfGoodsSent), Money(f.TransitLosses)),
            ToDto(expenses), kpis, items,
            withoutRecipe.Count, withoutRecipe.Sum(r => r.NetSales),
            Erosion(t, Money(revenueTotal), Money(f.FoodRecipe + f.DrinksRecipe)));
    }

    private static string Names(IReadOnlyList<string> names) =>
        names.Count == 1 ? names[0] : $"{string.Join(", ", names.Take(names.Count - 1))} and {names[^1]}";

    // A month's figures for the P&L: at the branch's own costs, with the markup paid to another
    // branch in each (what the company's P&L takes out), and the branch's dealings with the others.
    private sealed record Figures
    {
        public int Year { get; init; }
        public int Month { get; init; }
        public DateOnly From { get; init; }
        public DateOnly To { get; init; }
        public decimal Food { get; init; }
        public decimal Drinks { get; init; }
        public int PaidOrders { get; init; }
        public decimal SoldAtMenuPrices { get; init; }
        public IReadOnlyList<SafeTransaction> Takings { get; init; } = [];
        public IReadOnlyList<TheoreticalCostRow> Rows { get; init; } = [];
        public decimal FoodRecipe { get; init; }
        public decimal DrinksRecipe { get; init; }
        public decimal FoodMarkup { get; init; }
        public decimal DrinksMarkup { get; init; }
        public decimal KitchenWaste { get; init; }
        public decimal Spoilage { get; init; }
        public decimal CountDifferences { get; init; }
        public decimal WasteMarkup { get; init; }
        public decimal SpoilageMarkup { get; init; }
        public decimal CountsMarkup { get; init; }
        public decimal StaffMeals { get; init; }
        public decimal Hospitality { get; init; }
        public decimal RecipeTasting { get; init; }
        public decimal StaffMealsMarkup { get; init; }
        public decimal HospitalityMarkup { get; init; }
        public decimal TastingMarkup { get; init; }
        public IReadOnlyList<MonthlyExpenses> Entered { get; init; } = [];
        public IReadOnlyList<LoggedExpense> Logged { get; init; } = [];
        public decimal Salaries { get; init; }
        public decimal Breakage { get; init; }
        public decimal InterBranchSales { get; init; }
        public decimal CostOfGoodsSent { get; init; }
        public int Shipments { get; init; }
        public decimal InterBranchPurchases { get; init; }
        public decimal TransitLosses { get; init; }
        public decimal TransitMarkup { get; init; }
        public int Receipts { get; init; }

        public decimal MarkupInCostOfSales => FoodMarkup + DrinksMarkup + WasteMarkup + SpoilageMarkup + CountsMarkup + TransitMarkup;

        public decimal MarkupInExpenses => StaffMealsMarkup + HospitalityMarkup + TastingMarkup;

        public bool HasAny =>
            Takings.Count > 0 || Rows.Count > 0 || Entered.Count > 0 || Logged.Count > 0 || Salaries != 0 || Shipments > 0 || Receipts > 0
            || KitchenWaste != 0 || Spoilage != 0 || CountDifferences != 0 || StaffMeals != 0 || Hospitality != 0 || RecipeTasting != 0
            || Breakage != 0;

        // As the company sees them: nothing sold to or bought from itself, and every cost at what
        // the goods cost the company, not what one branch billed another.
        public Figures AtCompanyCost() => this with
        {
            Rows = Rows.Select(r => r with { TheoreticalCost = r.TheoreticalCost - r.InternalMarkup, InternalMarkup = 0 }).ToList(),
            FoodRecipe = FoodRecipe - FoodMarkup, DrinksRecipe = DrinksRecipe - DrinksMarkup, FoodMarkup = 0, DrinksMarkup = 0,
            KitchenWaste = KitchenWaste - WasteMarkup, Spoilage = Spoilage - SpoilageMarkup, CountDifferences = CountDifferences - CountsMarkup,
            WasteMarkup = 0, SpoilageMarkup = 0, CountsMarkup = 0,
            StaffMeals = StaffMeals - StaffMealsMarkup, Hospitality = Hospitality - HospitalityMarkup, RecipeTasting = RecipeTasting - TastingMarkup,
            StaffMealsMarkup = 0, HospitalityMarkup = 0, TastingMarkup = 0,
            InterBranchSales = 0, CostOfGoodsSent = 0, Shipments = 0, InterBranchPurchases = 0, Receipts = 0,
            TransitLosses = TransitLosses - TransitMarkup, TransitMarkup = 0,
        };

        // Several branches' figures as one: each figure added up; the expense invoices by category.
        public static Figures Sum(IReadOnlyList<Figures> all)
        {
            if (all.Count == 0)
                return new Figures();
            decimal Add(Func<Figures, decimal> of) => all.Sum(of);
            var first = all[0];
            return new Figures
            {
                Year = first.Year, Month = first.Month, From = first.From, To = first.To,
                Food = Add(f => f.Food), Drinks = Add(f => f.Drinks), PaidOrders = all.Sum(f => f.PaidOrders), SoldAtMenuPrices = Add(f => f.SoldAtMenuPrices),
                Takings = all.SelectMany(f => f.Takings).ToList(), Rows = all.SelectMany(f => f.Rows).ToList(),
                FoodRecipe = Add(f => f.FoodRecipe), DrinksRecipe = Add(f => f.DrinksRecipe), FoodMarkup = Add(f => f.FoodMarkup), DrinksMarkup = Add(f => f.DrinksMarkup),
                KitchenWaste = Add(f => f.KitchenWaste), Spoilage = Add(f => f.Spoilage), CountDifferences = Add(f => f.CountDifferences),
                WasteMarkup = Add(f => f.WasteMarkup), SpoilageMarkup = Add(f => f.SpoilageMarkup), CountsMarkup = Add(f => f.CountsMarkup),
                StaffMeals = Add(f => f.StaffMeals), Hospitality = Add(f => f.Hospitality), RecipeTasting = Add(f => f.RecipeTasting),
                StaffMealsMarkup = Add(f => f.StaffMealsMarkup), HospitalityMarkup = Add(f => f.HospitalityMarkup), TastingMarkup = Add(f => f.TastingMarkup),
                Entered = all.SelectMany(f => f.Entered).ToList(),
                Logged = all.SelectMany(f => f.Logged)
                    .GroupBy(e => e.CategoryId)
                    .Select(g => g.First() with { Amount = Money(g.Sum(e => e.Amount)) })
                    .OrderByDescending(e => e.Amount)
                    .ToList(),
                Salaries = Add(f => f.Salaries), Breakage = Add(f => f.Breakage),
                InterBranchSales = Add(f => f.InterBranchSales), CostOfGoodsSent = Add(f => f.CostOfGoodsSent), Shipments = all.Sum(f => f.Shipments),
                InterBranchPurchases = Add(f => f.InterBranchPurchases), TransitLosses = Add(f => f.TransitLosses), TransitMarkup = Add(f => f.TransitMarkup),
                Receipts = all.Sum(f => f.Receipts),
            };
        }
    }

    // The month's discounts against its revenue and its theoretical cost (DiscountImpact).
    internal static DiscountImpact Erosion(IReadOnlyCollection<SafeTransaction> takings, decimal netRevenue, decimal theoreticalCost)
    {
        var discounts = Money(takings.Sum(t => t.DiscountsAmount));
        var standard = Money(netRevenue + discounts);
        decimal? Share(decimal part, decimal whole) => whole > 0 ? Percent(part / whole) : null;
        var (standardPercent, actualPercent) = (Share(theoreticalCost, standard), Share(theoreticalCost, netRevenue));
        var reasons = takings.SelectMany(t => t.DiscountReasons)
            .GroupBy(r => r.Reason.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new DiscountReason(g.First().Reason.Trim(), Money(g.Sum(r => r.Amount)), g.Sum(r => r.Count)))
            .Where(r => r.Amount != 0 || r.Count != 0)
            .OrderByDescending(r => r.Amount).ThenByDescending(r => r.Count).ThenBy(r => r.Reason)
            .ToList();
        return new DiscountImpact(
            discounts, netRevenue, standard, Share(discounts, standard), theoreticalCost, standardPercent, actualPercent,
            actualPercent is { } actual && standardPercent is { } std ? Math.Round(actual - std, 1, MidpointRounding.AwayFromZero) : null,
            reasons);
    }

    // A branch's month (the first branch's while there is one): the whole month each time, a
    // figure left out not known yet. The consolidated P&L adds every branch's up.
    public async Task<MonthlyExpensesDto> SaveExpensesAsync(
        int year, int month, MonthlyExpensesDto request, string? by, CancellationToken cancellationToken, Guid? branchId = null)
    {
        if (month is < 1 or > 12 || year is < 2000 or > 2100)
            throw new DomainException("Choose a month.");
        // A month in the books closed keeps its expenses.
        await books.EnsureMonthOpenAsync(year, month, cancellationToken);
        var branch = branchId ?? Branch.DefaultId;
        var row = await db.MonthlyExpenses.SingleOrDefaultAsync(e => e.Year == year && e.Month == month && e.BranchId == branch, cancellationToken);
        if (row is null)
            db.MonthlyExpenses.Add(row = new MonthlyExpenses { Year = year, Month = month, BranchId = branch });
        row.WagesAndBenefits = request.WagesAndBenefits;
        row.LabourHours = request.LabourHours;
        row.OtherControllableCosts = request.OtherControllableCosts;
        row.OccupationCost = request.OccupationCost;
        row.Interest = request.Interest;
        row.Depreciation = request.Depreciation;
        row.UpdatedAtUtc = DateTime.UtcNow;
        row.UpdatedBy = by;
        row.Validate();
        await db.SaveChangesAsync(cancellationToken);
        return ToDto(row);
    }

    private static MonthlyExpensesDto ToDto(MonthlyExpenses? e) =>
        new(e?.WagesAndBenefits, e?.LabourHours, e?.OtherControllableCosts, e?.OccupationCost, e?.Interest, e?.Depreciation, e?.UpdatedAtUtc, e?.UpdatedBy);

    private static Kpi Ranged(string key, decimal? value, (decimal From, decimal To) range, bool highIsBad, string? missing) =>
        new(key, missing is null ? value : null, range.From, range.To, highIsBad,
            missing is not null || value is null ? KpiStatus.Missing
            : value > range.To ? KpiStatus.Above
            : value < range.From ? KpiStatus.Below
            : KpiStatus.Healthy,
            missing ?? (value is null ? "Nothing to measure this month." : null));

    private static Kpi Unranged(string key, decimal? value, string? missing) =>
        new(key, missing is null ? value : null, null, null, false, missing is null && value is not null ? KpiStatus.NoRange : KpiStatus.Missing, missing);
}
