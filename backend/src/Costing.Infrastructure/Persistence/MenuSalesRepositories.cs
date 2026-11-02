using Microsoft.EntityFrameworkCore;
using Costing.Domain.Access;
using Costing.Domain.Menu;
using Costing.Domain.Sales;
using Costing.Domain.Staff;

namespace Costing.Infrastructure.Persistence;

internal sealed class MenuRepository(CostingDbContext db) : IMenuRepository
{
    // A new item's number when none is given: after the highest there is, from 1001.
    private const int FirstNumber = 1001;

    public async Task<IReadOnlyList<MenuCategory>> GetCategoriesAsync(CancellationToken cancellationToken = default) =>
        await db.MenuCategories.OrderBy(c => c.DisplayOrder).ThenBy(c => c.Name).ToListAsync(cancellationToken);

    public Task<MenuCategory?> GetCategoryAsync(int id, CancellationToken cancellationToken = default) =>
        db.MenuCategories.SingleOrDefaultAsync(c => c.Id == id, cancellationToken);

    public void AddCategory(MenuCategory category) => db.MenuCategories.Add(category);

    public void RemoveCategory(MenuCategory category) => db.MenuCategories.Remove(category);

    public async Task<IReadOnlyList<MenuItem>> GetItemsAsync(CancellationToken cancellationToken = default) =>
        await db.MenuItems.OrderBy(m => m.Id).ToListAsync(cancellationToken);

    public Task<MenuItem?> GetItemAsync(int id, CancellationToken cancellationToken = default) =>
        db.MenuItems.SingleOrDefaultAsync(m => m.Id == id, cancellationToken);

    public async Task<int> NextItemNumberAsync(CancellationToken cancellationToken = default) =>
        Math.Max(FirstNumber, (await db.MenuItems.MaxAsync(m => (int?)m.Id, cancellationToken) ?? 0) + 1);

    public void AddItem(MenuItem item) => db.MenuItems.Add(item);

    public async Task<IReadOnlyList<AddOn>> GetAddOnsAsync(CancellationToken cancellationToken = default) =>
        await db.AddOns.OrderBy(a => a.Id).ToListAsync(cancellationToken);

    public Task<AddOn?> GetAddOnAsync(int id, CancellationToken cancellationToken = default) =>
        db.AddOns.SingleOrDefaultAsync(a => a.Id == id, cancellationToken);

    public void AddAddOn(AddOn addOn) => db.AddOns.Add(addOn);
}

internal sealed class SalesReceiptRepository(CostingDbContext db) : ISalesReceiptRepository
{
    public Task<SalesReceipt?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.SalesReceipts.SingleOrDefaultAsync(r => r.Id == id, cancellationToken);

    public void Add(SalesReceipt aggregate) => db.SalesReceipts.Add(aggregate);

    public async Task<IReadOnlyList<SalesReceipt>> GetPaidAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken = default) =>
        await db.SalesReceipts.AsNoTracking()
            .Where(r => r.VoidedAtUtc == null && r.SoldAtUtc >= fromUtc && r.SoldAtUtc < toUtc)
            .OrderBy(r => r.SoldAtUtc)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<SalesReceipt>> GetForDaysAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await db.SalesReceipts.AsNoTracking()
            .Where(r => r.BusinessDate >= from && r.BusinessDate <= to)
            .OrderByDescending(r => r.SoldAtUtc).ThenByDescending(r => r.EnteredAtUtc)
            .ToListAsync(cancellationToken);

    public Task<SalesReceipt?> GetDailySummaryAsync(DateOnly date, CancellationToken cancellationToken = default) =>
        db.SalesReceipts.FirstOrDefaultAsync(
            r => r.BusinessDate == date && r.Source == SalesSource.DailySummary && r.VoidedAtUtc == null, cancellationToken);

    public async Task<IReadOnlySet<string>> GetReferencesAsync(IReadOnlyCollection<string> references, CancellationToken cancellationToken = default)
    {
        if (references.Count == 0)
            return new HashSet<string>();
        var asked = references.ToList();
        return (await db.SalesReceipts.AsNoTracking()
                .Where(r => r.Reference != null && asked.Contains(r.Reference))
                .Select(r => r.Reference!)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }
}

internal sealed class StaffMemberRepository(CostingDbContext db) : IStaffMemberRepository
{
    public Task<StaffMember?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.Staff.SingleOrDefaultAsync(s => s.Id == id, cancellationToken);

    public void Add(StaffMember aggregate) => db.Staff.Add(aggregate);

    public async Task<IReadOnlyList<StaffMember>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.Staff.OrderBy(s => s.Name).ToListAsync(cancellationToken);
}

internal sealed class UserTabAccessRepository(CostingDbContext db) : IUserTabAccessRepository
{
    public Task<UserTabAccess?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.UserTabAccess.SingleOrDefaultAsync(a => a.Id == id, cancellationToken);

    public void Add(UserTabAccess aggregate) => db.UserTabAccess.Add(aggregate);

    public Task<UserTabAccess?> GetByUserAsync(string userId, CancellationToken cancellationToken = default) =>
        db.UserTabAccess.SingleOrDefaultAsync(a => a.UserId == userId, cancellationToken);

    public async Task<IReadOnlyList<UserTabAccess>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.UserTabAccess.ToListAsync(cancellationToken);

    public void Remove(UserTabAccess access) => db.UserTabAccess.Remove(access);
}

// The rate the treasury takes off a day's takings entered with the tax in them: the bills' own, as
// set on Tax & service.
internal sealed class FinancialTaxRate(CostingDbContext db) : Costing.Application.Treasury.ITaxRate
{
    public async Task<decimal> PercentAsync(CancellationToken cancellationToken) =>
        (await db.FinancialSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken))?.TaxPercent
        ?? throw new Costing.Domain.Common.DomainException("Set the tax rate on Financials → Tax & service first.");
}
