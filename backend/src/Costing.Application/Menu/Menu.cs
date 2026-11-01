using MediatR;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Common;
using Costing.Domain.Menu;

namespace Costing.Application.Menu;

// The menu (قائمة الطعام): its categories, items and their sizes, and the add-ons, what the
// recipes sell by and the sales name. Kept here, or imported from a sheet, so the costs need no
// point of sale. An item's number is its code on the reports: given, or the next one after the
// highest.

public sealed record MenuCategoryDto(int Id, string Name, string? NameAr, int DisplayOrder, int Items);

public sealed record MenuSizeDto(int Id, string Name, string? NameAr, decimal Price);

public sealed record MenuItemDto(
    int Id, string Name, string? NameAr, string Category, decimal Price, bool IsPriceBasedOnAddons, bool IsAvailable, bool IsDeleted,
    IReadOnlyList<MenuSizeDto> Sizes, IReadOnlyList<int> AddOnIds)
{
    public static MenuItemDto From(MenuItem item) => new(
        item.Id, item.Name, item.NameAr, item.Category, item.Price, item.IsPriceBasedOnAddons, item.IsAvailable, item.IsDeleted,
        item.Variants.OrderBy(v => v.DisplayOrder).ThenBy(v => v.Id).Select(v => new MenuSizeDto(v.Id, v.Name, v.NameAr, v.Price)).ToList(),
        item.AddOnIds);
}

public sealed record AddOnDto(int Id, string Name, string? NameAr, decimal Price, bool IsDeleted);

public sealed record MenuDto(IReadOnlyList<MenuCategoryDto> Categories, IReadOnlyList<MenuItemDto> Items, IReadOnlyList<AddOnDto> AddOns);

// Deleted items and add-ons too, marked: a recipe or a sale may name one.
public sealed record GetMenuQuery : IRequest<MenuDto>;

internal sealed class GetMenuHandler(IMenuRepository menu) : IRequestHandler<GetMenuQuery, MenuDto>
{
    public async Task<MenuDto> Handle(GetMenuQuery request, CancellationToken cancellationToken) => await MenuReader.ReadAsync(menu, cancellationToken);
}

internal static class MenuReader
{
    public static async Task<MenuDto> ReadAsync(IMenuRepository menu, CancellationToken cancellationToken)
    {
        var items = await menu.GetItemsAsync(cancellationToken);
        var counts = items.Where(i => !i.IsDeleted).GroupBy(i => i.Category, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);
        var categories = (await menu.GetCategoriesAsync(cancellationToken))
            .Select(c => new MenuCategoryDto(c.Id, c.Name, c.NameAr, c.DisplayOrder, counts.GetValueOrDefault(c.Name)))
            .ToList();
        return new MenuDto(
            categories, items.Select(MenuItemDto.From).ToList(),
            (await menu.GetAddOnsAsync(cancellationToken)).Select(a => new AddOnDto(a.Id, a.Name, a.NameAr, a.Price, a.IsDeleted)).ToList());
    }
}

// ---- Categories ----

// Added (no Id) or renamed; a rename moves its items with it.
public sealed record SaveMenuCategoryCommand(int? Id, string Name, string? NameAr, int? DisplayOrder) : IRequest<MenuDto>, IRetryOnConflict;

internal sealed class SaveMenuCategoryHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<SaveMenuCategoryCommand, MenuDto>
{
    public async Task<MenuDto> Handle(SaveMenuCategoryCommand request, CancellationToken cancellationToken)
    {
        var categories = await menu.GetCategoriesAsync(cancellationToken);
        var name = request.Name?.Trim() ?? string.Empty;
        if (categories.Any(c => c.Id != request.Id && string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase)))
            throw new DomainException($"There is a category called {name} already.");

        if (request.Id is { } id)
        {
            var category = await menu.GetCategoryAsync(id, cancellationToken) ?? throw new NotFoundException("Menu category", id);
            var before = category.Name;
            category.Rename(name, request.NameAr);
            if (request.DisplayOrder is { } order)
                category.MoveTo(order);
            if (!string.Equals(before, category.Name, StringComparison.Ordinal))
            {
                foreach (var item in (await menu.GetItemsAsync(cancellationToken)).Where(i => string.Equals(i.Category, before, StringComparison.OrdinalIgnoreCase)))
                    item.MoveToCategory(category.Name);
            }
        }
        else
        {
            menu.AddCategory(new MenuCategory(name, request.NameAr, request.DisplayOrder ?? (categories.Count == 0 ? 1 : categories.Max(c => c.DisplayOrder) + 1)));
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await MenuReader.ReadAsync(menu, cancellationToken);
    }
}

// Only an empty one: its items are moved to another first.
public sealed record DeleteMenuCategoryCommand(int Id) : IRequest<MenuDto>;

internal sealed class DeleteMenuCategoryHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<DeleteMenuCategoryCommand, MenuDto>
{
    public async Task<MenuDto> Handle(DeleteMenuCategoryCommand request, CancellationToken cancellationToken)
    {
        var category = await menu.GetCategoryAsync(request.Id, cancellationToken) ?? throw new NotFoundException("Menu category", request.Id);
        var inIt = (await menu.GetItemsAsync(cancellationToken)).Count(i => !i.IsDeleted && string.Equals(i.Category, category.Name, StringComparison.OrdinalIgnoreCase));
        if (inIt > 0)
            throw new DomainException($"{category.Name} has {inIt} {(inIt == 1 ? "item" : "items")}: move them to another category first.");
        menu.RemoveCategory(category);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await MenuReader.ReadAsync(menu, cancellationToken);
    }
}

// ---- Items ----

public sealed record MenuSizeInput(string Name, string? NameAr, decimal Price);

// Added (no Id: Number, or the next one) or changed. Its category is one on the menu, by name.
public sealed record SaveMenuItemCommand(
    int? Id, int? Number, string Name, string? NameAr, string Category, decimal Price, bool IsPriceBasedOnAddons, bool IsAvailable,
    IReadOnlyList<MenuSizeInput>? Sizes, IReadOnlyList<int>? AddOnIds) : IRequest<MenuItemDto>, IRetryOnConflict;

internal sealed class SaveMenuItemHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<SaveMenuItemCommand, MenuItemDto>
{
    public async Task<MenuItemDto> Handle(SaveMenuItemCommand request, CancellationToken cancellationToken)
    {
        var category = await MenuChecks.CategoryAsync(menu, request.Category, cancellationToken);
        await MenuChecks.AddOnsAsync(menu, request.AddOnIds ?? [], cancellationToken);
        if (request.IsPriceBasedOnAddons && (request.AddOnIds ?? []).Count == 0)
            throw new DomainException("An item priced by its add-ons has at least one add-on.");

        MenuItem item;
        if (request.Id is { } id)
        {
            item = await menu.GetItemAsync(id, cancellationToken) ?? throw new NotFoundException("Menu item", id);
            item.Change(request.Name, request.NameAr, category.Name, request.Price, request.IsPriceBasedOnAddons);
        }
        else
        {
            var number = request.Number ?? await menu.NextItemNumberAsync(cancellationToken);
            if (await menu.GetItemAsync(number, cancellationToken) is { } taken)
                throw new DomainException($"Number {number} is {taken.Name}'s: choose another, or leave it for the next one.");
            item = new MenuItem(number, request.Name, request.NameAr, category.Name, request.Price, request.IsPriceBasedOnAddons);
            menu.AddItem(item);
        }

        item.SetVariants((request.Sizes ?? []).Select(s => (s.Name, s.NameAr, s.Price)).ToList());
        item.SetAddOns(request.AddOnIds ?? []);
        item.SetAvailable(request.IsAvailable);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return MenuItemDto.From(item);
    }
}

// Off the menu, or back on it. Its recipe and its sales stay.
public sealed record SetMenuItemDeletedCommand(int Id, bool Deleted) : IRequest<MenuItemDto>;

internal sealed class SetMenuItemDeletedHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<SetMenuItemDeletedCommand, MenuItemDto>
{
    public async Task<MenuItemDto> Handle(SetMenuItemDeletedCommand request, CancellationToken cancellationToken)
    {
        var item = await menu.GetItemAsync(request.Id, cancellationToken) ?? throw new NotFoundException("Menu item", request.Id);
        if (request.Deleted)
            item.Delete();
        else
            item.Restore();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return MenuItemDto.From(item);
    }
}

// ---- Add-ons ----

public sealed record SaveAddOnCommand(int? Id, string Name, string? NameAr, decimal Price) : IRequest<AddOnDto>, IRetryOnConflict;

internal sealed class SaveAddOnHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<SaveAddOnCommand, AddOnDto>
{
    public async Task<AddOnDto> Handle(SaveAddOnCommand request, CancellationToken cancellationToken)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if ((await menu.GetAddOnsAsync(cancellationToken)).Any(a => a.Id != request.Id && !a.IsDeleted && string.Equals(a.Name, name, StringComparison.OrdinalIgnoreCase)))
            throw new DomainException($"There is an add-on called {name} already.");
        AddOn addOn;
        if (request.Id is { } id)
        {
            addOn = await menu.GetAddOnAsync(id, cancellationToken) ?? throw new NotFoundException("Add-on", id);
            addOn.Change(name, request.NameAr, request.Price);
        }
        else
        {
            addOn = new AddOn(name, request.NameAr, request.Price);
            menu.AddAddOn(addOn);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new AddOnDto(addOn.Id, addOn.Name, addOn.NameAr, addOn.Price, addOn.IsDeleted);
    }
}

public sealed record SetAddOnDeletedCommand(int Id, bool Deleted) : IRequest<AddOnDto>;

internal sealed class SetAddOnDeletedHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<SetAddOnDeletedCommand, AddOnDto>
{
    public async Task<AddOnDto> Handle(SetAddOnDeletedCommand request, CancellationToken cancellationToken)
    {
        var addOn = await menu.GetAddOnAsync(request.Id, cancellationToken) ?? throw new NotFoundException("Add-on", request.Id);
        if (request.Deleted)
            addOn.Delete();
        else
            addOn.Restore();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new AddOnDto(addOn.Id, addOn.Name, addOn.NameAr, addOn.Price, addOn.IsDeleted);
    }
}

internal static class MenuChecks
{
    public static async Task<MenuCategory> CategoryAsync(IMenuRepository menu, string? name, CancellationToken cancellationToken)
    {
        var wanted = name?.Trim();
        if (string.IsNullOrEmpty(wanted))
            throw new DomainException("Choose its category.");
        return (await menu.GetCategoriesAsync(cancellationToken)).SingleOrDefault(c => string.Equals(c.Name, wanted, StringComparison.OrdinalIgnoreCase))
            ?? throw new DomainException($"There is no category {wanted}: add it first.");
    }

    public static async Task AddOnsAsync(IMenuRepository menu, IReadOnlyList<int> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
            return;
        var known = (await menu.GetAddOnsAsync(cancellationToken)).Where(a => !a.IsDeleted).Select(a => a.Id).ToHashSet();
        if (ids.FirstOrDefault(id => !known.Contains(id)) is var missing and not 0)
            throw new DomainException($"There is no add-on {missing}: choose one on the menu.");
    }
}

// ---- Import ----

// A row of a menu sheet: an item, or one of its sizes on a row of its own under the same number
// or name. A category not on the menu is added; an item already there (by its number, or its
// name) is changed; a size is added to it or changed.
public sealed record MenuImportRow(
    int Row, int? Number, string? Name, string? NameAr, string? Category, string? CategoryAr, decimal? Price, string? Size, string? SizeAr,
    decimal? SizePrice);

public sealed record MenuImportResult(int Added, int Updated, int CategoriesAdded, IReadOnlyList<SkippedSheetRow> Skipped);

public sealed record ImportMenuCommand(IReadOnlyList<MenuImportRow> Rows) : IRequest<MenuImportResult>;

internal sealed class ImportMenuHandler(IMenuRepository menu, IUnitOfWork unitOfWork) : IRequestHandler<ImportMenuCommand, MenuImportResult>
{
    public const int MaxRows = 5_000;

    public async Task<MenuImportResult> Handle(ImportMenuCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no items on it.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import {MaxRows:N0} rows at most at a time: split the sheet.");

        var categories = (await menu.GetCategoriesAsync(cancellationToken)).ToDictionary(c => c.Name, StringComparer.OrdinalIgnoreCase);
        var items = (await menu.GetItemsAsync(cancellationToken)).ToDictionary(i => i.Id);
        var byName = items.Values.GroupBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var nextNumber = await menu.NextItemNumberAsync(cancellationToken);
        var nextOrder = categories.Count == 0 ? 1 : categories.Values.Max(c => c.DisplayOrder) + 1;

        var skipped = new List<SkippedSheetRow>();
        var added = new HashSet<int>();
        var updated = new HashSet<int>();
        var categoriesAdded = 0;
        var sizes = new Dictionary<int, List<(string Name, string? NameAr, decimal Price)>>();

        foreach (var row in request.Rows)
        {
            try
            {
                var name = row.Name?.Trim();
                var item = row.Number is { } number ? items.GetValueOrDefault(number) : null;
                item ??= name is { Length: > 0 } ? byName.GetValueOrDefault(name) : null;

                if (item is null)
                {
                    if (string.IsNullOrEmpty(name))
                        throw new DomainException("No item name.");
                    var categoryName = row.Category?.Trim();
                    if (string.IsNullOrEmpty(categoryName))
                        throw new DomainException("No category.");
                    if (!categories.TryGetValue(categoryName, out var category))
                    {
                        category = new MenuCategory(categoryName, row.CategoryAr, nextOrder++);
                        menu.AddCategory(category);
                        categories[category.Name] = category;
                        categoriesAdded++;
                    }

                    var newNumber = row.Number ?? nextNumber;
                    if (row.Number is null)
                        nextNumber++;
                    else if (newNumber >= nextNumber)
                        nextNumber = newNumber + 1;
                    item = new MenuItem(newNumber, name, row.NameAr, category.Name, row.Price ?? 0, false);
                    menu.AddItem(item);
                    items[item.Id] = item;
                    byName[item.Name] = item;
                    added.Add(item.Id);
                }
                else if (!added.Contains(item.Id) && (row.Price is not null || !string.IsNullOrWhiteSpace(row.Category) || !string.IsNullOrWhiteSpace(row.NameAr)))
                {
                    var categoryName = string.IsNullOrWhiteSpace(row.Category) ? item.Category : row.Category.Trim();
                    if (!categories.TryGetValue(categoryName, out var category))
                    {
                        category = new MenuCategory(categoryName, row.CategoryAr, nextOrder++);
                        menu.AddCategory(category);
                        categories[category.Name] = category;
                        categoriesAdded++;
                    }

                    item.Change(name is { Length: > 0 } ? name : item.Name, row.NameAr ?? item.NameAr, category.Name, row.Price ?? item.Price, item.IsPriceBasedOnAddons);
                    updated.Add(item.Id);
                }

                if (!string.IsNullOrWhiteSpace(row.Size))
                {
                    if (!sizes.TryGetValue(item.Id, out var list))
                    {
                        sizes[item.Id] = list = item.Variants.OrderBy(v => v.DisplayOrder).Select(v => (v.Name, v.NameAr, v.Price)).ToList();
                    }
                    var size = (Name: row.Size.Trim(), NameAr: string.IsNullOrWhiteSpace(row.SizeAr) ? null : row.SizeAr.Trim(), Price: row.SizePrice ?? row.Price ?? 0);
                    var at = list.FindIndex(s => string.Equals(s.Name, size.Name, StringComparison.OrdinalIgnoreCase));
                    if (at >= 0)
                        list[at] = size;
                    else
                        list.Add(size);
                    if (!added.Contains(item.Id))
                        updated.Add(item.Id);
                }
            }
            catch (DomainException ex)
            {
                skipped.Add(new SkippedSheetRow(row.Row, row.Name, ex.Message));
            }
        }

        foreach (var (id, list) in sizes)
            items[id].SetVariants(list);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new MenuImportResult(added.Count, updated.Count, categoriesAdded, skipped);
    }
}
