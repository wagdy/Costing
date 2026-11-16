using MediatR;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Menu;
using Costing.Domain.Recipes;

namespace Costing.Application.Menu;

// Combo offers (العروض والوجبات المجمعة), built on Recipes → Combos & offers: existing recipes and how
// many of each, at a price of the combo's own. Saved, its menu item is made or brought in line
// (ComboOffer, MenuItem.SellAs) in the same save, in the Combos & offers category, so the sales and
// the point of sale sell it under its code. What it costs is worked out whenever it is read.

public sealed record ComboItemInput(Guid RecipeId, int Quantity);

// Added (an id not saved yet) or changed. Code: the menu number it is sold under, kept once saved.
public sealed record SaveComboOfferCommand(
    Guid Id, int Code, string Name, string? NameAr, decimal SellingPrice, bool IsActive, IReadOnlyList<ComboItemInput> Items)
    : IRequest<ComboOfferSaved>, IRetryOnConflict;

public sealed record ComboOfferSaved(Guid Id, int Code);

// Off the menu and the list, kept for the sales that name it.
public sealed record DeleteComboOfferCommand(Guid Id, string StaffName = "") : IRequest;

public static class ComboRules
{
    public static string InCombo(string dish, IEnumerable<string> combos) =>
        $"{dish} is in the combo {string.Join(", ", combos)}: take it out of the combo first. · الصنف داخل عرض مجمع.";

    public const string ComboOnMenu =
        "This is a combo offer: change it on Recipes → Combos & offers. · هذا عرض مجمع: عدّله من الوصفات ← العروض المجمعة.";
}

internal sealed class SaveComboOfferHandler(IComboOfferRepository combos, IRecipeRepository recipes, IMenuRepository menu, IUnitOfWork unitOfWork)
    : IRequestHandler<SaveComboOfferCommand, ComboOfferSaved>
{
    public async Task<ComboOfferSaved> Handle(SaveComboOfferCommand request, CancellationToken cancellationToken)
    {
        var items = (request.Items ?? []).Select(i => new ComboPart(i.RecipeId, i.Quantity)).ToList();
        var dishes = (await recipes.GetByIdsAsync(items.Select(i => i.RecipeId).Distinct().ToList(), cancellationToken)).ToDictionary(r => r.Id);
        foreach (var item in items)
        {
            var recipe = dishes.GetValueOrDefault(item.RecipeId) ?? throw new NotFoundException(nameof(Recipe), item.RecipeId);
            if (recipe.IsDeleted)
                throw new DomainException($"{recipe.Name ?? "A recipe"} is deleted: it cannot go in a combo. · الوصفة محذوفة.");
        }

        var combo = await combos.GetByIdAsync(request.Id, cancellationToken);
        MenuItem? menuItem;
        if (combo is null)
        {
            if (await menu.GetItemAsync(request.Code, cancellationToken) is { } taken)
                throw new DomainException($"Number {request.Code} is {taken.Name}'s on the menu: choose another. · الرقم مستخدم.");
            combo = new ComboOffer(request.Id, request.Code, request.Name, request.NameAr, request.SellingPrice, request.IsActive, items);
            combos.Add(combo);
            await EnsureCategoryAsync(cancellationToken);
            menuItem = new MenuItem(combo.Code, combo.Name, combo.NameAr, ComboOffer.MenuCategory, combo.SellingPrice, false);
            menu.AddItem(menuItem);
        }
        else
        {
            if (combo.Code != request.Code)
                throw new DomainException("A combo keeps its code: its sales are under it. · كود العرض لا يتغير.");
            combo.Change(request.Name, request.NameAr, request.SellingPrice, request.IsActive, items);
            menuItem = await menu.GetItemAsync(combo.Code, cancellationToken);
            if (menuItem is null)
            {
                await EnsureCategoryAsync(cancellationToken);
                menuItem = new MenuItem(combo.Code, combo.Name, combo.NameAr, ComboOffer.MenuCategory, combo.SellingPrice, false);
                menu.AddItem(menuItem);
            }
        }

        menuItem.SellAs(combo);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new ComboOfferSaved(combo.Id, combo.Code);
    }

    // The combos' own category on the menu, last, added the first time.
    private async Task EnsureCategoryAsync(CancellationToken cancellationToken)
    {
        var categories = await menu.GetCategoriesAsync(cancellationToken);
        if (categories.Any(c => string.Equals(c.Name, ComboOffer.MenuCategory, StringComparison.OrdinalIgnoreCase)))
            return;
        menu.AddCategory(new MenuCategory(ComboOffer.MenuCategory, ComboOffer.MenuCategoryAr, categories.Count == 0 ? 1 : categories.Max(c => c.DisplayOrder) + 1));
    }
}

internal sealed class DeleteComboOfferHandler(IComboOfferRepository combos, IMenuRepository menu, IUnitOfWork unitOfWork)
    : IRequestHandler<DeleteComboOfferCommand>
{
    public async Task Handle(DeleteComboOfferCommand request, CancellationToken cancellationToken)
    {
        var combo = await combos.GetRequiredAsync(request.Id, cancellationToken);
        combo.Delete(request.StaffName);
        if (await menu.GetItemAsync(combo.Code, cancellationToken) is { } menuItem)
            menuItem.SellAs(combo);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}
