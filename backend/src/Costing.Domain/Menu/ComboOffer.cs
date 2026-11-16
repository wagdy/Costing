using Costing.Domain.Common;
using Costing.Domain.Recipes;

namespace Costing.Domain.Menu;

// A combo offer (عرض / وجبة مجمعة): dishes the kitchen already makes, sold together at a price of
// their own, with no bill of materials of its own. Each item is an existing recipe and how many of
// it one combo takes (two pizzas, a drink): what it costs is theirs, worked out whenever asked, and
// a sale of it takes each recipe's stock as that many sales of the dish would (StockRequirements).
//
// Sold under its code, a menu number (as 6101 is): the menu carries it as an item (MenuItem with
// ComboOfferId, in the Combos & offers category, at its price, available while it is active), so
// the sales, the Z reports and a point of sale reading the menu sell it as any other item. Its name,
// price and availability are the combo's, changed here and never on the Menu tab.
//
// Deleted, it is only marked so, with its menu item: past sales still name it.
public sealed class ComboOffer : AggregateRoot
{
    public const int MaxItems = 20;
    public const int MaxQuantity = 99;
    public const string MenuCategory = "Combos & offers";
    public const string MenuCategoryAr = "العروض والوجبات المجمعة";

    private readonly List<ComboOfferItem> _items = [];

    private ComboOffer() { }

    public ComboOffer(Guid id, int code, string name, string? nameAr, decimal sellingPrice, bool isActive, IReadOnlyList<ComboPart> items)
    {
        if (code <= 0)
            throw new DomainException("A combo's code is a menu number, 1 or more. · كود العرض رقم 1 أو أكثر.");
        Id = id;
        Code = code;
        CreatedAtUtc = DateTime.UtcNow;
        Change(name, nameAr, sellingPrice, isActive, items);
    }

    // The menu number it is sold under: its item's on the menu, on every sale and Z report.
    public int Code { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }

    // What the combo sells at, the dishes together (السعر بعد الخصم).
    public decimal SellingPrice { get; private set; }

    // On sale: its menu item available.
    public bool IsActive { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? DeletedAtUtc { get; private set; }
    public string? DeletedBy { get; private set; }
    public bool IsDeleted => DeletedAtUtc is not null;

    public IReadOnlyCollection<ComboOfferItem> Items => _items.AsReadOnly();

    // What it is made of, for the stock and the costs: each recipe and how many of it one combo takes.
    public IReadOnlyList<ComboPart> Parts => _items.OrderBy(i => i.Position).Select(i => new ComboPart(i.RecipeId, i.Quantity)).ToList();

    // Each recipe once, 1 to 99 of it, 20 at most, two dishes at least (two of one is a combo).
    // A recipe kept keeps its line.
    public void Change(string name, string? nameAr, decimal sellingPrice, bool isActive, IReadOnlyList<ComboPart> items)
    {
        if (IsDeleted)
            throw new DomainException("This combo is deleted. · هذا العرض محذوف.");
        if (sellingPrice <= 0)
            throw new DomainException("A combo sells at more than nothing. · سعر العرض أكبر من صفر.");
        if (items.Count == 0)
            throw new DomainException("Add the dishes the combo is made of. · أضف أصناف العرض.");
        if (items.Count > MaxItems)
            throw new DomainException($"A combo has {MaxItems} dishes at most. · {MaxItems} صنفًا على الأكثر.");
        if (items.Select(i => i.RecipeId).Distinct().Count() != items.Count)
            throw new DomainException("Each dish goes on the combo once: set how many of it instead. · كل صنف مرة واحدة.");
        if (items.Any(i => i.Quantity is < 1 or > MaxQuantity))
            throw new DomainException($"Each dish is 1 to {MaxQuantity} in a combo. · الكمية من 1 إلى {MaxQuantity}.");
        if (items.Sum(i => i.Quantity) < 2)
            throw new DomainException("A combo is two dishes at least, or two of one. · العرض صنفان على الأقل.");

        Name = MenuText.Name(name, "the combo");
        NameAr = MenuText.Optional(nameAr, MenuItem.MaxNameLength);
        SellingPrice = Math.Round(sellingPrice, 2, MidpointRounding.AwayFromZero);
        IsActive = isActive;
        _items.RemoveAll(i => items.All(x => x.RecipeId != i.RecipeId));
        for (var position = 0; position < items.Count; position++)
        {
            var part = items[position];
            if (_items.SingleOrDefault(i => i.RecipeId == part.RecipeId) is { } kept)
                kept.Change(part.Quantity, position);
            else
                _items.Add(new ComboOfferItem(Id, part.RecipeId, part.Quantity, position));
        }
    }

    public void Delete(string deletedBy)
    {
        if (IsDeleted)
            return;
        DeletedAtUtc = DateTime.UtcNow;
        DeletedBy = deletedBy;
        IsActive = false;
    }
}

// A dish in a combo: an existing recipe (a menu item's, a size's, an add-on's or one off the menu),
// how many of it one combo takes, and where it comes in the combo (as entered).
public sealed class ComboOfferItem : Entity
{
    private ComboOfferItem() { }

    internal ComboOfferItem(Guid comboOfferId, Guid recipeId, int quantity, int position)
    {
        ComboOfferId = comboOfferId;
        RecipeId = recipeId;
        Change(quantity, position);
    }

    public Guid ComboOfferId { get; private set; }
    public Guid RecipeId { get; private set; }
    public int Quantity { get; private set; }
    public int Position { get; private set; }

    internal void Change(int quantity, int position)
    {
        Quantity = quantity;
        Position = position;
    }
}

public interface IComboOfferRepository : IRepository<ComboOffer>
{
    // Deleted ones too.
    Task<IReadOnlyList<ComboOffer>> GetAllAsync(CancellationToken cancellationToken = default);

    // What the combos sold under these menu numbers are made of (deleted ones' too: a sale of one
    // still takes its stock), by number.
    Task<IReadOnlyDictionary<int, IReadOnlyList<ComboPart>>> GetPartsAsync(IReadOnlyCollection<int> menuItemIds, CancellationToken cancellationToken = default);

    // Those not deleted with the recipe in them.
    Task<IReadOnlyList<ComboOffer>> GetUsingRecipeAsync(Guid recipeId, CancellationToken cancellationToken = default);
}
