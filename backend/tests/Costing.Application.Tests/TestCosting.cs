using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Costing.Application;
using Costing.Application.Common;
using Costing.Domain.Access;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Common;
using Costing.Domain.Expenses;
using Costing.Domain.Menu;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.Staff;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;
using Costing.Domain.Waste;

namespace Costing.Application.Tests;

// The use cases wired as the API wires them, over stores in memory. One request a scope, as one
// HTTP request; what a request did not save is lost, as a failed request's would be.
public sealed class TestCosting
{
    // The test menu: a burger at 120 with cheese at 15 on it, and shawarma by the tray, a kilo at
    // 400 or a half at 220. The numbers are the menu's codes.
    public const int Burger = 1, Shawarma = 10, KiloTray = 101, HalfTray = 102, Cheese = 7;

    private readonly ServiceProvider _services;

    public InventoryStore Inventory { get; } = new();
    public MenuStore Menu { get; } = new();
    public SalesStore Sales { get; } = new();
    public StaffStore Staff { get; } = new();
    public BreakageStore Breakage { get; } = new();
    public TabStore Tabs { get; } = new();
    public ProfileStore Profile { get; } = new();
    public SettingsStore Settings { get; } = new();

    // Names and dates for the records: the business day can be set a day behind the calendar, as
    // it is after midnight.
    public NamesFromTheTestMenu Dates { get; } = new();
    public FixedTaxRate TaxRate { get; } = new(14m);

    public TestCosting()
    {
        var services = new ServiceCollection();
        services.AddSingleton(typeof(ILogger<>), typeof(NullLogger<>));
        services.AddSingleton(TimeProvider.System);
        services.AddCostingApplication();
        services.AddSingleton<IUnitOfWork>(new NoUnitOfWork());
        services.AddSingleton<IBusinessCalendar>(new TestCalendar());
        services.AddSingleton<Costing.Application.Treasury.ITaxRate>(TaxRate);
        services.AddSingleton<IRawMaterialRepository>(Inventory);
        services.AddSingleton<IRecipeRepository>(Inventory.Recipes);
        services.AddSingleton<IRecipeCategoryRepository>(Inventory.RecipeCategories);
        services.AddSingleton<IStockMovementRepository>(Inventory.Movements);
        services.AddSingleton<IStockCountRepository>(Inventory.Counts);
        services.AddSingleton<IPurchaseInvoiceRepository>(Inventory.Invoices);
        services.AddSingleton<IPurchaseAttachmentStore>(Inventory.Invoices);
        services.AddSingleton<ISupplierRepository>(Inventory.Suppliers);
        services.AddSingleton<IPurchaseCategoryRepository>(Inventory.PurchaseCategories);
        services.AddSingleton<IExpenseItemRepository>(Inventory.ExpenseItems);
        services.AddSingleton<IApprovalRequestRepository>(Inventory.ApprovalRequests);
        services.AddSingleton<ISafeTransactionRepository>(Inventory.Safe);
        services.AddSingleton<ISupplierLedgerRepository>(Inventory.SupplierLedger);
        services.AddSingleton<Costing.Application.Approvals.IRecordDescriptions>(Dates);
        services.AddSingleton<IPrepRecipeRepository>(Inventory.PrepRecipes);
        services.AddSingleton<IProductionOrderRepository>(Inventory.Production);
        services.AddSingleton<Costing.Application.RawMaterials.IMaterialUnits>(Inventory.Units);
        services.AddSingleton<Costing.Application.Categories.IItemConversions>(new NoItemConversions());
        services.AddSingleton<IMenuRepository>(Menu);
        services.AddSingleton<ISalesReceiptRepository>(Sales);
        services.AddSingleton<IStaffMemberRepository>(Staff);
        services.AddSingleton<IBreakageEntryRepository>(Breakage);
        services.AddSingleton<IUserTabAccessRepository>(Tabs);
        services.AddSingleton<ICompanyProfile>(Profile);
        services.AddSingleton<Costing.Domain.Company.ICompanySettingsStore>(Settings);
        _services = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
        Menu.SeedTestMenu();
    }

    public async Task<T> Send<T>(IRequest<T> request)
    {
        using var scope = _services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<ISender>().Send(request);
    }

    public async Task Send(IRequest request)
    {
        using var scope = _services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<ISender>().Send(request);
    }

    private sealed class NoUnitOfWork : IUnitOfWork
    {
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => Task.FromResult(1);
    }
}

// The business day is today, and spans the hour around now.
public sealed class TestCalendar : IBusinessCalendar
{
    public static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private readonly DateTime _start = DateTime.UtcNow.AddHours(-1);

    public DateOnly BusinessDateOf(DateTime utc) => DateOnly.FromDateTime(utc);

    public DateOnly LocalDateOf(DateTime utc) => DateOnly.FromDateTime(utc);

    public DateTime ToLocal(DateTime utc) => utc;

    public DateTime ToUtc(DateTime local) => DateTime.SpecifyKind(local, DateTimeKind.Utc);

    public (DateTime FromUtc, DateTime ToUtc) Bounds(DateOnly businessDate)
    {
        var start = businessDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        return (start, start.AddDays(1));
    }
}

// The bills' tax, 14% unless a test changes it.
public sealed class FixedTaxRate(decimal percent) : Costing.Application.Treasury.ITaxRate
{
    public decimal Percent { get; set; } = percent;

    public Task<decimal> PercentAsync(CancellationToken cancellationToken) => Task.FromResult(Percent);
}

public sealed class MenuStore : IMenuRepository
{
    private readonly List<MenuCategory> _categories = [];
    private readonly List<MenuItem> _items = [];
    private readonly List<AddOn> _addOns = [];

    // Burger 120 with Cheese +15; Shawarma in a Kilo tray (400) or Half tray (220). Ids set as the
    // database would give them.
    public void SeedTestMenu()
    {
        AddCategory(new MenuCategory("Mains", null, 1));
        var cheese = new AddOn("Cheese", null, 15);
        Number(cheese, TestCosting.Cheese);
        _addOns.Add(cheese);
        var burger = new MenuItem(TestCosting.Burger, "Burger", null, "Mains", 120, false);
        burger.SetAddOns([TestCosting.Cheese]);
        _items.Add(burger);
        var shawarma = new MenuItem(TestCosting.Shawarma, "Shawarma", null, "Mains", 0, false);
        shawarma.SetVariants([("Kilo tray", null, 400), ("Half tray", null, 220)]);
        Number(shawarma.Variants.Single(v => v.Name == "Kilo tray"), TestCosting.KiloTray);
        Number(shawarma.Variants.Single(v => v.Name == "Half tray"), TestCosting.HalfTray);
        _items.Add(shawarma);
    }

    private static void Number(object entity, int id) => entity.GetType().GetProperty("Id")!.SetValue(entity, id);

    private int _next = 100;

    public Task<IReadOnlyList<MenuCategory>> GetCategoriesAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<MenuCategory>>(_categories.ToList());
    public Task<MenuCategory?> GetCategoryAsync(int id, CancellationToken cancellationToken = default) => Task.FromResult(_categories.SingleOrDefault(c => c.Id == id));
    public void AddCategory(MenuCategory category)
    {
        Number(category, ++_next);
        _categories.Add(category);
    }
    public void RemoveCategory(MenuCategory category) => _categories.Remove(category);
    public Task<IReadOnlyList<MenuItem>> GetItemsAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<MenuItem>>(_items.ToList());
    public Task<MenuItem?> GetItemAsync(int id, CancellationToken cancellationToken = default) => Task.FromResult(_items.SingleOrDefault(i => i.Id == id));
    public Task<int> NextItemNumberAsync(CancellationToken cancellationToken = default) => Task.FromResult(Math.Max(1001, _items.Max(i => i.Id) + 1));
    public void AddItem(MenuItem item)
    {
        foreach (var size in item.Variants.Where(v => v.Id == 0))
            Number(size, ++_next);
        _items.Add(item);
    }
    public Task<IReadOnlyList<AddOn>> GetAddOnsAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<AddOn>>(_addOns.ToList());
    public Task<AddOn?> GetAddOnAsync(int id, CancellationToken cancellationToken = default) => Task.FromResult(_addOns.SingleOrDefault(a => a.Id == id));
    public void AddAddOn(AddOn addOn)
    {
        Number(addOn, ++_next);
        _addOns.Add(addOn);
    }
}

// The company's settings held for the app, as the infrastructure's store holds them: the money
// format of the messages set with them.
public sealed class ProfileStore : ICompanyProfile
{
    public CompanyProfile Current { get; private set; } = new(
        "Test kitchen", new Costing.Domain.Company.MoneyFormat("L.E", Costing.Domain.Company.CurrencyPosition.Before), Costing.Domain.Company.Country.Egypt,
        "Africa/Cairo", 4, false, null);

    public void Set(CompanyProfile profile)
    {
        Current = profile;
        CompanyMoney.Format = profile.Money;
    }
}

public sealed class SettingsStore : Costing.Domain.Company.ICompanySettingsStore
{
    public Costing.Domain.Company.CompanySettings? Row { get; private set; }
    public byte[]? Logo { get; private set; }

    public Task<Costing.Domain.Company.CompanySettings?> GetAsync(CancellationToken cancellationToken = default) => Task.FromResult(Row);
    public void Add(Costing.Domain.Company.CompanySettings settings) => Row = settings;
    public Task PutLogoAsync(byte[]? content, CancellationToken cancellationToken = default)
    {
        Logo = content;
        return Task.CompletedTask;
    }
    public Task<byte[]?> GetLogoAsync(CancellationToken cancellationToken = default) => Task.FromResult(Logo);
}

public abstract class ListStore<T> : IRepository<T> where T : AggregateRoot
{
    public List<T> All { get; } = [];

    public Task<T?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(All.SingleOrDefault(x => x.Id == id));
    public void Add(T aggregate) => All.Add(aggregate);
}

public sealed class SalesStore : ListStore<SalesReceipt>, ISalesReceiptRepository
{
    public Task<IReadOnlyList<SalesReceipt>> GetPaidAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<SalesReceipt>>(All.Where(r => !r.IsVoided && r.SoldAtUtc >= fromUtc && r.SoldAtUtc < toUtc).ToList());
    public Task<IReadOnlyList<SalesReceipt>> GetForDaysAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<SalesReceipt>>(All.Where(r => r.BusinessDate >= from && r.BusinessDate <= to).OrderByDescending(r => r.SoldAtUtc).ToList());
    public Task<IReadOnlySet<string>> GetReferencesAsync(IReadOnlyCollection<string> references, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlySet<string>>(All.Where(r => r.Reference != null && references.Contains(r.Reference, StringComparer.OrdinalIgnoreCase))
            .Select(r => r.Reference!).ToHashSet(StringComparer.OrdinalIgnoreCase));
}

public sealed class StaffStore : ListStore<StaffMember>, IStaffMemberRepository
{
    public Task<IReadOnlyList<StaffMember>> GetAllAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<StaffMember>>(All.OrderBy(s => s.Name).ToList());
}

public sealed class BreakageStore : ListStore<BreakageEntry>, IBreakageEntryRepository
{
    public Task<IReadOnlyList<BreakageEntry>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<BreakageEntry>>(All.Where(b => b.BusinessDate >= from && b.BusinessDate <= to).ToList());
    public Task<BreakageEntry?> GetForTransactionAsync(Guid assetTransactionId, CancellationToken cancellationToken = default) =>
        Task.FromResult(All.SingleOrDefault(b => b.AssetTransactionId == assetTransactionId));
}

public sealed class TabStore : ListStore<UserTabAccess>, IUserTabAccessRepository
{
    public Task<UserTabAccess?> GetByUserAsync(string userId, CancellationToken cancellationToken = default) => Task.FromResult(All.SingleOrDefault(a => a.UserId == userId));
    public Task<IReadOnlyList<UserTabAccess>> GetAllAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<UserTabAccess>>(All.ToList());
    public void Remove(UserTabAccess access) => All.Remove(access);
}

public sealed class InventoryStore : IRawMaterialRepository
{
    private readonly List<RawMaterial> _materials = new();

    public RecipeStore Recipes { get; } = new();
    public RecipeCategoryStore RecipeCategories { get; } = new();
    public MovementStore Movements { get; } = new();
    public CountStore Counts { get; } = new();
    public InvoiceStore Invoices { get; } = new();
    public SupplierStore Suppliers { get; } = new();
    public ExpenseItemStore ExpenseItems { get; } = new();
    public ApprovalRequestStore ApprovalRequests { get; } = new();
    public SafeStore Safe { get; } = new();
    public SupplierLedgerStore SupplierLedger { get; } = new();
    public PurchaseCategoryStore PurchaseCategories => _purchaseCategories ??= new(this, ExpenseItems);
    private PurchaseCategoryStore? _purchaseCategories;
    public PrepRecipeStore PrepRecipes { get; } = new();
    public ProductionStore Production { get; } = new();
    public MaterialUnitStore Units => _units ??= new(Movements);
    private MaterialUnitStore? _units;

    public RawMaterial Stock(string name, UnitOfMeasure unit, decimal onHand)
    {
        var material = new RawMaterial(name, unit);
        material.ReceivePurchase(onHand, Guid.NewGuid());
        _materials.Add(material);
        return material;
    }

    public Task<RawMaterial?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_materials.SingleOrDefault(m => m.Id == id));
    public void Add(RawMaterial aggregate) => _materials.Add(aggregate);
    public Task<IReadOnlyList<RawMaterial>> GetAllAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<RawMaterial>>(_materials.ToList());
    public Task<IReadOnlyList<RawMaterial>> GetByIdsAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<RawMaterial>>(_materials.Where(m => ids.Contains(m.Id)).ToList());
    public Task<IReadOnlyList<RawMaterial>> GetNeedingReorderAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<RawMaterial>>(_materials.Where(m => m.NeedsReorder).ToList());
}

// What records a material, as far as these stores keep it: its ledger. Restating it is the
// database's, and is tested against one (NodeTests).
public sealed class MaterialUnitStore(MovementStore movements) : Costing.Application.RawMaterials.IMaterialUnits
{
    public Task<Costing.Application.RawMaterials.MaterialUsage> UsageAsync(
        RawMaterial material, Guid? exceptRequestId, CancellationToken cancellationToken) =>
        Task.FromResult(new Costing.Application.RawMaterials.MaterialUsage(movements.All.Count(m => m.RawMaterialId == material.Id), 0, 0, 0, 0, 0, 0));

    public Task RestateAndSaveAsync(RawMaterial material, decimal oneNewIsOld, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Restated in the database: see NodeTests.");
}

// Converting raw materials to expense items reads and restates the database's records: tested
// against one (NodeTests). Here nothing stops it and nothing is restated.
public sealed class NoItemConversions : Costing.Application.Categories.IItemConversions
{
    public Task<IReadOnlyList<string>> ExpenseBlockersAsync(
        IReadOnlyList<RawMaterial> materials, IReadOnlyDictionary<Guid, Guid> namesakes, Guid? exceptRequestId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<string>>([]);

    public Task<Costing.Application.Categories.ExpenseRestatement> RestatementAsync(
        IReadOnlyList<Guid> materialIds, CancellationToken cancellationToken) =>
        Task.FromResult(new Costing.Application.Categories.ExpenseRestatement(0, 0, 0, 0));

    public Task<int> PendingNamingAsync(IReadOnlyCollection<Guid> ids, Guid? exceptRequestId, CancellationToken cancellationToken) => Task.FromResult(0);

    public Task RestateAndSaveAsync(IReadOnlyList<(Guid MaterialId, Guid ExpenseItemId)> pairs, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Restated in the database: see NodeTests.");
}

public sealed class RecipeStore : IRecipeRepository
{
    private readonly List<Recipe> _recipes = new();

    public Task<Recipe?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_recipes.SingleOrDefault(r => r.Id == id));
    public void Add(Recipe aggregate) => _recipes.Add(aggregate);
    public Task<IReadOnlyList<Recipe>> GetAllAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Recipe>>(_recipes.ToList());
    public Task<int> CountUsingAsync(Guid rawMaterialId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_recipes.Count(r => !r.IsDeleted && r.Ingredients.Any(i => i.RawMaterialId == rawMaterialId)));
    // The ones sales go by: not deleted, and linked to the menu.
    private IEnumerable<Recipe> Active => _recipes.Where(r => !r.IsDeleted && r.Target is not null);
    public Task<Recipe?> GetByTargetAsync(RecipeTarget target, CancellationToken cancellationToken = default) => Task.FromResult(Active.SingleOrDefault(r => r.Target == target));
    public Task<IReadOnlyList<Recipe>> GetByTargetsAsync(IReadOnlyCollection<RecipeTarget> targets, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Recipe>>(Active.Where(r => targets.Contains(r.Target!.Value)).ToList());
    public Task<IReadOnlyList<Recipe>> GetInCategoryAsync(Guid categoryId, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Recipe>>(_recipes.Where(r => r.RecipeCategoryId == categoryId).ToList());
    public Task<IReadOnlyDictionary<Guid, int>> CountByCategoryAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<Guid, int>>(_recipes.Where(r => !r.IsDeleted && r.RecipeCategoryId != null).GroupBy(r => r.RecipeCategoryId!.Value).ToDictionary(g => g.Key, g => g.Count()));
}

public sealed class MovementStore : IStockMovementRepository
{
    public List<StockMovement> All { get; } = new();

    public Task<StockMovement?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(All.SingleOrDefault(m => m.Id == id));
    public void Add(StockMovement aggregate) => All.Add(aggregate);
    public Task<bool> ExistsAsync(Guid sourceId, StockMovementReason reason, CancellationToken cancellationToken = default) => Task.FromResult(All.Any(m => m.SourceId == sourceId && m.Reason == reason));
    public Task<IReadOnlyList<StockMovement>> GetBySourceAsync(Guid sourceId, StockMovementReason reason, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<StockMovement>>(All.Where(m => m.SourceId == sourceId && m.Reason == reason).ToList());
}

public sealed class CountStore : IStockCountRepository
{
    private readonly List<StockCount> _counts = new();

    public Task<StockCount?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_counts.SingleOrDefault(c => c.Id == id));
    public void Add(StockCount aggregate) => _counts.Add(aggregate);
    public void Remove(StockCount draft) => _counts.Remove(draft);
    public Task<StockCount?> GetDraftAsync(CancellationToken cancellationToken = default) => Task.FromResult(_counts.FirstOrDefault(c => c.Status == StockCountStatus.Draft));
    public Task<IReadOnlyList<StockCount>> GetAllAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<StockCount>>(_counts.ToList());
    public Task<IReadOnlyDictionary<Guid, DateTime>> CountedBeforeAsync(
        IReadOnlyCollection<Guid> rawMaterialIds, Guid exceptStockCountId, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<Guid, DateTime>>(_counts
            .Where(c => c.Status == StockCountStatus.Posted && c.Id != exceptStockCountId)
            .SelectMany(c => c.Lines.Where(l => rawMaterialIds.Contains(l.RawMaterialId)).Select(l => (l.RawMaterialId, Posted: c.PostedAtUtc!.Value)))
            .GroupBy(x => x.RawMaterialId)
            .ToDictionary(g => g.Key, g => g.Min(x => x.Posted)));
}

public sealed class InvoiceStore : IPurchaseInvoiceRepository, IPurchaseAttachmentStore
{
    private readonly List<PurchaseInvoice> _invoices = new();
    private readonly Dictionary<Guid, byte[]> _attachments = new();

    public Task<PurchaseInvoice?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_invoices.SingleOrDefault(i => i.Id == id));
    public void Add(PurchaseInvoice aggregate) => _invoices.Add(aggregate);
    public void Remove(PurchaseInvoice draft) => _invoices.Remove(draft);
    public Task<IReadOnlyList<PurchaseInvoice>> GetByStatusAsync(PurchaseInvoiceStatus status, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<PurchaseInvoice>>(_invoices.Where(i => i.Status == status).ToList());
    public Task<IReadOnlyDictionary<Guid, SupplierUse>> GetSupplierUseAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<Guid, SupplierUse>>(_invoices.Where(i => i.SupplierId != null).GroupBy(i => i.SupplierId!.Value)
            .ToDictionary(g => g.Key, g => new SupplierUse(
                g.Count(), g.Where(i => i.Status == PurchaseInvoiceStatus.Posted).Sum(i => i.Total), g.Max(i => i.PostedAtUtc))));
    public Task<bool> AnyForSupplierAsync(Guid supplierId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_invoices.Any(i => i.SupplierId == supplierId));
    public Task<IReadOnlyDictionary<Guid, ExpenseItemUse>> GetExpenseItemUseAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<Guid, ExpenseItemUse>>(_invoices
            .SelectMany(i => i.Lines.Where(l => l.ExpenseItemId != null).Select(l => (Invoice: i, Line: l)))
            .GroupBy(x => x.Line.ExpenseItemId!.Value)
            .ToDictionary(g => g.Key, g => new ExpenseItemUse(
                g.Count(), g.Where(x => x.Invoice.Status == PurchaseInvoiceStatus.Posted).Sum(x => x.Line.Cost ?? 0), g.Max(x => x.Invoice.PostedAtUtc))));
    public Task<bool> AnyForExpenseItemAsync(Guid expenseItemId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_invoices.Any(i => i.Lines.Any(l => l.ExpenseItemId == expenseItemId)));
    public void Put(Guid invoiceId, byte[] content) => _attachments[invoiceId] = content;
    public Task<byte[]?> GetAsync(Guid invoiceId, CancellationToken cancellationToken = default) => Task.FromResult(_attachments.GetValueOrDefault(invoiceId));
}

public sealed class SupplierStore : ISupplierRepository
{
    private readonly List<Supplier> _suppliers = new();

    public Task<Supplier?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_suppliers.SingleOrDefault(s => s.Id == id));
    public void Add(Supplier aggregate) => _suppliers.Add(aggregate);
    public void Remove(Supplier supplier) => _suppliers.Remove(supplier);
    public Task<IReadOnlyList<Supplier>> GetAllAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<Supplier>>(_suppliers.ToList());
    public Task<Supplier?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default) =>
        Task.FromResult(_suppliers.SingleOrDefault(s => s.NormalizedName == normalizedName));
}

public sealed class PrepRecipeStore : IPrepRecipeRepository
{
    private readonly List<PrepRecipe> _recipes = new();

    public Task<PrepRecipe?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_recipes.SingleOrDefault(r => r.Id == id));
    public void Add(PrepRecipe aggregate) => _recipes.Add(aggregate);
    public Task<IReadOnlyList<PrepRecipe>> GetAllAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<PrepRecipe>>(_recipes.ToList());
    public Task<IReadOnlyList<PrepRecipe>> GetInCategoryAsync(Guid recipeCategoryId, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<PrepRecipe>>(_recipes.Where(r => r.RecipeCategoryId == recipeCategoryId).ToList());
}

public sealed class ProductionStore : IProductionOrderRepository
{
    private readonly List<ProductionOrder> _orders = new();

    public Task<ProductionOrder?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_orders.SingleOrDefault(o => o.Id == id));
    public void Add(ProductionOrder aggregate) => _orders.Add(aggregate);
    public Task<IReadOnlyList<ProductionOrder>> GetRecentAsync(Guid? prepItemId, int take, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<ProductionOrder>>(_orders.Where(o => prepItemId == null || o.PrepItemId == prepItemId)
            .OrderByDescending(o => o.ProducedAtUtc).Take(take).ToList());
}

public sealed class RecipeCategoryStore : IRecipeCategoryRepository
{
    private readonly List<RecipeCategory> _categories = new();

    public Task<RecipeCategory?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_categories.SingleOrDefault(c => c.Id == id));
    public void Add(RecipeCategory aggregate) => _categories.Add(aggregate);
    public void Remove(RecipeCategory category) => _categories.Remove(category);
    public Task<IReadOnlyList<RecipeCategory>> GetAllAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<RecipeCategory>>(_categories.ToList());
    public Task<RecipeCategory?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default) =>
        Task.FromResult(_categories.SingleOrDefault(c => c.NormalizedName == normalizedName));
}

public sealed class PurchaseCategoryStore : IPurchaseCategoryRepository
{
    private readonly List<PurchaseCategory> _categories = new();
    private readonly InventoryStore _materials;
    private readonly ExpenseItemStore _expenses;

    public PurchaseCategoryStore(InventoryStore materials, ExpenseItemStore expenses) => (_materials, _expenses) = (materials, expenses);

    public Task<PurchaseCategory?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_categories.SingleOrDefault(c => c.Id == id));
    public void Add(PurchaseCategory aggregate) => _categories.Add(aggregate);
    public void Remove(PurchaseCategory category) => _categories.Remove(category);
    public Task<IReadOnlyList<PurchaseCategory>> GetAllAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<PurchaseCategory>>(_categories.ToList());
    public Task<PurchaseCategory?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default) =>
        Task.FromResult(_categories.SingleOrDefault(c => c.NormalizedName == normalizedName));
    public async Task<IReadOnlyDictionary<Guid, PurchaseCategoryUse>> GetUseAsync(CancellationToken cancellationToken = default)
    {
        var materials = (await _materials.GetAllAsync(cancellationToken)).GroupBy(m => m.CategoryId).ToDictionary(g => g.Key, g => g.ToList());
        var expenses = (await _expenses.GetAllAsync(cancellationToken)).GroupBy(e => e.CategoryId).ToDictionary(g => g.Key, g => g.ToList());
        return materials.Keys.Union(expenses.Keys)
            .ToDictionary(id => id, id => new PurchaseCategoryUse(
                materials.GetValueOrDefault(id)?.Count ?? 0, expenses.GetValueOrDefault(id)?.Count ?? 0,
                materials.GetValueOrDefault(id)?.Count(m => !m.IsArchived) ?? 0, expenses.GetValueOrDefault(id)?.Count(e => !e.IsArchived) ?? 0));
    }
}

public sealed class ExpenseItemStore : IExpenseItemRepository
{
    private readonly List<ExpenseItem> _items = new();

    public Task<ExpenseItem?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_items.SingleOrDefault(e => e.Id == id));
    public void Add(ExpenseItem aggregate) => _items.Add(aggregate);
    public void Remove(ExpenseItem item) => _items.Remove(item);
    public Task<IReadOnlyList<ExpenseItem>> GetAllAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<ExpenseItem>>(_items.ToList());
    public Task<IReadOnlyList<ExpenseItem>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<ExpenseItem>>(_items.Where(e => ids.Contains(e.Id)).ToList());
    public Task<IReadOnlyList<ExpenseItem>> GetInCategoryAsync(Guid categoryId, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<ExpenseItem>>(_items.Where(e => e.CategoryId == categoryId).ToList());
    public Task<ExpenseItem?> GetByNormalizedNameAsync(string normalizedName, CancellationToken cancellationToken = default) =>
        Task.FromResult(_items.SingleOrDefault(e => e.NormalizedName == normalizedName));
}

public sealed class SafeStore : ISafeTransactionRepository
{
    private readonly List<SafeTransaction> _entries = new();

    public Task<SafeTransaction?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_entries.SingleOrDefault(t => t.Id == id));
    public void Add(SafeTransaction aggregate) => _entries.Add(aggregate);
    public Task<decimal> SafeBalanceAsync(DateOnly? through = null, CancellationToken cancellationToken = default) =>
        Task.FromResult(_entries.Where(t => t.Fund == CashFund.Safe && (through == null || t.BusinessDate <= through)).Sum(t => t.Amount));
    public Task<SafeTransaction?> GetTakingsAsync(DateOnly revenueDate, CancellationToken cancellationToken = default) =>
        Task.FromResult(_entries.FirstOrDefault(t => t.Kind == SafeTransactionKind.RevenueTransfer && t.RevenueDate == revenueDate && !t.IsReversal && !t.IsVoided));
    public Task<decimal> PaidOutOfTakingsAsync(DateOnly revenueDate, CancellationToken cancellationToken = default) =>
        Task.FromResult(-_entries.Where(t => t.Fund == CashFund.DayRevenue && t.RevenueDate == revenueDate).Sum(t => t.Amount));
    public Task<SafeTransaction?> GetPaymentOfInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_entries.SingleOrDefault(t => t.PurchaseInvoiceId == invoiceId && t.Kind == SafeTransactionKind.InvoicePayment && !t.IsReversal && !t.IsVoided));
    public Task<IReadOnlySet<Guid>> PaidInvoicesAsync(IReadOnlyCollection<Guid> invoiceIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlySet<Guid>>(_entries
            .Where(t => t.Kind == SafeTransactionKind.InvoicePayment && !t.IsReversal && !t.IsVoided && t.PurchaseInvoiceId is { } id && invoiceIds.Contains(id))
            .Select(t => t.PurchaseInvoiceId!.Value).ToHashSet());
    public Task<bool> AnyOpeningBalanceAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(_entries.Any(t => t.Kind == SafeTransactionKind.OpeningBalance && !t.IsReversal && !t.IsVoided));
    public Task<IReadOnlyList<SafeTransaction>> GetForPayrollMonthAsync(DateOnly month, Guid? employeeId = null, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<SafeTransaction>>(_entries
            .Where(t => t.PayrollMonth == month && t.EmployeeId != null && (employeeId == null || t.EmployeeId == employeeId)).ToList());
    public Task<IReadOnlyList<SafeTransaction>> GetPendingAdvancesAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<SafeTransaction>>(_entries.Where(t => t.IsPendingAdvance && !t.IsReversal && !t.IsVoided).ToList());
}

public sealed class SupplierLedgerStore : ISupplierLedgerRepository
{
    private readonly List<SupplierLedgerEntry> _lines = new();

    public Task<SupplierLedgerEntry?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_lines.SingleOrDefault(l => l.Id == id));
    public void Add(SupplierLedgerEntry aggregate) => _lines.Add(aggregate);
    public Task<decimal> BalanceAsync(Guid supplierId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_lines.Where(l => l.SupplierId == supplierId).Sum(l => l.Amount));
    public Task<IReadOnlyList<SupplierLedgerEntry>> GetBySourceAsync(Guid sourceId, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<SupplierLedgerEntry>>(_lines.Where(l => l.SourceId == sourceId).ToList());
}

public sealed class ApprovalRequestStore : IApprovalRequestRepository
{
    private readonly List<ApprovalRequest> _requests = new();

    public Task<ApprovalRequest?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult(_requests.SingleOrDefault(r => r.Id == id));
    public void Add(ApprovalRequest aggregate) => _requests.Add(aggregate);
    public Task<IReadOnlyList<ApprovalRequest>> GetPendingAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<ApprovalRequest>>(_requests.Where(r => r.IsPending).OrderBy(r => r.RequestedAtUtc).ToList());
    public Task<IReadOnlyList<ApprovalRequest>> GetDecidedAsync(int take, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<ApprovalRequest>>(_requests.Where(r => !r.IsPending).OrderByDescending(r => r.DecidedAtUtc).Take(take).ToList());
    public Task<ApprovalRequest?> GetPendingForAsync(Guid recordId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_requests.SingleOrDefault(r => r.IsPending && r.RecordId == recordId));
}

// The test menu's names for a recipe's summary, and dates as they fall in UTC.
public sealed class NamesFromTheTestMenu : Costing.Application.Approvals.IRecordDescriptions
{
    public Task<string?> MenuItemNameAsync(RecipeTargetKind kind, int catalogItemId, int? variantId, CancellationToken cancellationToken) =>
        Task.FromResult<string?>($"Menu item {catalogItemId}");

    public DateOnly BusinessDateOf(DateTime utc) => DateOnly.FromDateTime(utc).AddDays(-BusinessDayBehind);

    public DateOnly LocalDateOf(DateTime utc) => DateOnly.FromDateTime(utc);

    public DateTime LocalTimeOf(DateTime utc) => DateTime.SpecifyKind(utc, DateTimeKind.Unspecified);

    // 1 for the hours after midnight, before the business day starts: the business date is a day
    // behind the calendar.
    public int BusinessDayBehind { get; set; }
}
