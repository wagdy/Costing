using Costing.Domain.Common;

namespace Costing.Domain.Menu;

// The menu (قائمة الطعام) the recipes sell by: its items, their sizes, the add-ons, and the
// categories they are grouped in. Kept here, so the costs need no point of sale: entered on the
// Menu tab, or imported from a sheet.
//
// Numbered, not given a Guid: an item's number is its code on every report (6101, a size of it
// 6101-2, an add-on A3), as the menu numbers them. A recipe names what it sells by by these
// numbers (RecipeTarget).
public sealed class MenuCategory
{
    public const int MaxNameLength = 100;

    private MenuCategory() { }

    public MenuCategory(string name, string? nameAr, int displayOrder)
    {
        Rename(name, nameAr);
        DisplayOrder = displayOrder;
    }

    public int Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }
    public int DisplayOrder { get; private set; }

    public void Rename(string name, string? nameAr)
    {
        Name = MenuText.Name(name, "the category");
        NameAr = MenuText.Optional(nameAr, MaxNameLength);
    }

    public void MoveTo(int displayOrder) => DisplayOrder = displayOrder;
}

// A dish or a drink. Category is its category's name, as the reports group and match it (the
// beverage categories are names). Price is what it sells at; with sizes, each size's price is,
// and Price is not charged. Priced by its add-ons (a kilo of mixed grill), it has no price of
// its own. Deleted, it is only marked so: past sales and recipes still name it.
public sealed class MenuItem
{
    public const int MaxNameLength = 200;

    private readonly List<MenuItemVariant> _variants = [];

    private MenuItem() { }

    public MenuItem(int id, string name, string? nameAr, string category, decimal price, bool isPriceBasedOnAddons)
    {
        if (id <= 0)
            throw new DomainException("An item's number is 1 or more.");
        Id = id;
        Change(name, nameAr, category, price, isPriceBasedOnAddons);
    }

    public int Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }
    public string Category { get; private set; } = string.Empty;
    public decimal Price { get; private set; }
    public bool IsAvailable { get; private set; } = true;
    public bool IsPriceBasedOnAddons { get; private set; }
    public bool IsDeleted { get; private set; }

    // The add-ons it can be sold with, by their numbers.
    public int[] AddOnIds { get; private set; } = [];

    public IReadOnlyCollection<MenuItemVariant> Variants => _variants.AsReadOnly();

    public void Change(string name, string? nameAr, string category, decimal price, bool isPriceBasedOnAddons)
    {
        if (price < 0)
            throw new DomainException("A price cannot be negative.");
        Name = MenuText.Name(name, "the item");
        NameAr = MenuText.Optional(nameAr, MaxNameLength);
        Category = MenuText.Name(category, "its category");
        IsPriceBasedOnAddons = isPriceBasedOnAddons;
        Price = isPriceBasedOnAddons ? 0 : price;
    }

    public void SetAvailable(bool available) => IsAvailable = available;

    public void SetAddOns(IEnumerable<int> addOnIds) => AddOnIds = addOnIds.Distinct().Order().ToArray();

    // Its category renamed: the items keep the name the category goes by.
    public void MoveToCategory(string category) => Category = MenuText.Name(category, "its category");

    // Sets its sizes as listed: one named as one already there keeps its number (so its recipe and
    // its sales stay with it), a new name is a new size, and one not listed is taken off.
    public void SetVariants(IReadOnlyList<(string Name, string? NameAr, decimal Price)> sizes)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var size in sizes)
        {
            if (!names.Add(MenuText.Name(size.Name, "each size")))
                throw new DomainException($"There are two sizes called {size.Name.Trim()}.");
            if (size.Price < 0)
                throw new DomainException("A price cannot be negative.");
        }

        _variants.RemoveAll(v => !names.Contains(v.Name));
        for (var i = 0; i < sizes.Count; i++)
        {
            var (name, nameAr, price) = sizes[i];
            var existing = _variants.SingleOrDefault(v => string.Equals(v.Name, name.Trim(), StringComparison.OrdinalIgnoreCase));
            if (existing is null)
                _variants.Add(new MenuItemVariant(Id, name, nameAr, price, i));
            else
                existing.Change(name, nameAr, price, i);
        }
    }

    public void Delete() => IsDeleted = true;

    public void Restore() => IsDeleted = false;
}

// One size of an item: "500g", "1 Kilo", "Family tray". Its price is what the size sells at, not
// added to the item's.
public sealed class MenuItemVariant
{
    private MenuItemVariant() { }

    internal MenuItemVariant(int menuItemId, string name, string? nameAr, decimal price, int displayOrder)
    {
        MenuItemId = menuItemId;
        Change(name, nameAr, price, displayOrder);
    }

    public int Id { get; private set; }
    public int MenuItemId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }
    public decimal Price { get; private set; }
    public int DisplayOrder { get; private set; }

    internal void Change(string name, string? nameAr, decimal price, int displayOrder)
    {
        Name = MenuText.Name(name, "each size");
        NameAr = MenuText.Optional(nameAr, MenuItem.MaxNameLength);
        Price = price;
        DisplayOrder = displayOrder;
    }
}

// Something added to an item, at its own price: "Extra cheese", "Side rice". It can have a
// recipe of its own, which a sale with it takes too.
public sealed class AddOn
{
    private AddOn() { }

    public AddOn(string name, string? nameAr, decimal price) => Change(name, nameAr, price);

    public int Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? NameAr { get; private set; }
    public decimal Price { get; private set; }
    public bool IsDeleted { get; private set; }

    public void Change(string name, string? nameAr, decimal price)
    {
        if (price < 0)
            throw new DomainException("A price cannot be negative.");
        Name = MenuText.Name(name, "the add-on");
        NameAr = MenuText.Optional(nameAr, MenuItem.MaxNameLength);
        Price = price;
    }

    public void Delete() => IsDeleted = true;

    public void Restore() => IsDeleted = false;
}

internal static class MenuText
{
    public static string Name(string? value, string what)
    {
        var name = value?.Trim();
        if (string.IsNullOrEmpty(name))
            throw new DomainException($"Name {what}.");
        if (name.Length > MenuItem.MaxNameLength)
            throw new DomainException($"Keep the name under {MenuItem.MaxNameLength} characters.");
        return name;
    }

    public static string? Optional(string? value, int max)
    {
        var text = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        if (text?.Length > max)
            throw new DomainException($"Keep the name under {max} characters.");
        return text;
    }
}

// The menu, loaded and saved by its numbers. Nothing on it is removed: deleted items and add-ons
// are marked so, and a category goes only when no item is in it.
public interface IMenuRepository
{
    Task<IReadOnlyList<MenuCategory>> GetCategoriesAsync(CancellationToken cancellationToken = default);

    Task<MenuCategory?> GetCategoryAsync(int id, CancellationToken cancellationToken = default);

    void AddCategory(MenuCategory category);

    void RemoveCategory(MenuCategory category);

    // Deleted ones too, with their sizes.
    Task<IReadOnlyList<MenuItem>> GetItemsAsync(CancellationToken cancellationToken = default);

    Task<MenuItem?> GetItemAsync(int id, CancellationToken cancellationToken = default);

    Task<int> NextItemNumberAsync(CancellationToken cancellationToken = default);

    void AddItem(MenuItem item);

    // Deleted ones too.
    Task<IReadOnlyList<AddOn>> GetAddOnsAsync(CancellationToken cancellationToken = default);

    Task<AddOn?> GetAddOnAsync(int id, CancellationToken cancellationToken = default);

    void AddAddOn(AddOn addOn);
}
