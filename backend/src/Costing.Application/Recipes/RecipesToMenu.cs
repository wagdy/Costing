using MediatR;
using Costing.Domain.Common;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Menu;
using Costing.Domain.Recipes;

namespace Costing.Application.Recipes;

// Recipes off the menu put on it (إضافة للمنيو): each a menu item of its name, at the price and in
// the menu category given, and the recipe linked to it, so that selling it on Sales, entered or
// imported, takes its stock by the recipe and counts in the reports. The item is numbered as the
// next one, as a new item is; a category not on the menu yet is added.
//
// A menu item of the recipe's name already there (not deleted) with no recipe of its own is the
// one it is linked to, as it is: never a second of that name. One with a recipe already is left
// alone. Each recipe is checked on its own: one that cannot go on is said why, in English and
// Arabic, and the rest go on.

public sealed record RecipeToMenu(Guid RecipeId, string? Category, decimal? Price, string? NameAr = null);

public sealed record AddRecipesToMenuCommand(IReadOnlyList<RecipeToMenu> Recipes) : IRequest<RecipesToMenuResult>, IRetryOnConflict;

// On the menu: the item it sells as (Created: a new one; else one there already), by its code.
public sealed record RecipeOnMenu(Guid RecipeId, string Recipe, int MenuItemId, string Category, decimal Price, bool Created);

public sealed record RecipeNotOnMenu(Guid RecipeId, string? Recipe, string Reason, string ReasonAr);

public sealed record RecipesToMenuResult(IReadOnlyList<RecipeOnMenu> Linked, IReadOnlyList<RecipeNotOnMenu> Skipped, IReadOnlyList<string> CategoriesAdded);

internal sealed class AddRecipesToMenuHandler(IRecipeRepository recipes, IMenuRepository menu, IApprovalRequestRepository approvals, IUnitOfWork unitOfWork)
    : IRequestHandler<AddRecipesToMenuCommand, RecipesToMenuResult>
{
    public const int MaxRecipes = 1000;

    public async Task<RecipesToMenuResult> Handle(AddRecipesToMenuCommand request, CancellationToken cancellationToken)
    {
        if (request.Recipes.Count == 0)
            throw new DomainException("Choose the recipes to put on the menu. · اختر الوصفات لإضافتها للمنيو.");
        if (request.Recipes.Count > MaxRecipes)
            throw new DomainException($"Put at most {MaxRecipes:N0} recipes on the menu at a time. · {MaxRecipes:N0} وصفة على الأكثر في المرة.");

        var all = (await recipes.GetAllAsync(cancellationToken)).ToDictionary(r => r.Id);
        var sold = all.Values.Where(r => !r.IsDeleted && r.Target is not null).Select(r => r.Target!.Value).ToHashSet();
        var pending = (await approvals.GetPendingAsync(cancellationToken)).Select(r => r.RecordId).ToHashSet();
        var categories = (await menu.GetCategoriesAsync(cancellationToken)).ToDictionary(c => MenuKey(c.Name));
        var items = await menu.GetItemsAsync(cancellationToken);
        var byName = items.Where(i => !i.IsDeleted).GroupBy(i => MenuKey(i.Name)).ToDictionary(g => g.Key, g => g.First());
        var next = await menu.NextItemNumberAsync(cancellationToken);
        var nextOrder = categories.Count == 0 ? 1 : categories.Values.Max(c => c.DisplayOrder) + 1;

        var linked = new List<RecipeOnMenu>();
        var skipped = new List<RecipeNotOnMenu>();
        var added = new List<string>();
        foreach (var asked in request.Recipes.DistinctBy(r => r.RecipeId))
        {
            var recipe = all.GetValueOrDefault(asked.RecipeId);
            void Skip(string reason, string reasonAr) => skipped.Add(new RecipeNotOnMenu(asked.RecipeId, recipe?.Name, reason, reasonAr));

            if (recipe is null || recipe.IsDeleted)
            {
                Skip("The recipe is no longer there, or was deleted.", "الوصفة لم تعد موجودة أو محذوفة.");
                continue;
            }
            if (recipe.Target is { } target)
            {
                Skip($"{recipe.Name ?? "It"} is on the menu already, as {Code(target)}.", $"{recipe.Name ?? "الوصفة"} في المنيو بالفعل بكود {Code(target)}.");
                continue;
            }
            if (pending.Contains(recipe.Id))
            {
                Skip($"{recipe.Name} waits for a manager's approval: put it on the menu once that is decided.", $"{recipe.Name} بانتظار موافقة المدير.");
                continue;
            }

            var name = recipe.Name!;
            try
            {
                // A menu item of its name with no recipe: that one, as it is.
                if (byName.GetValueOrDefault(MenuKey(name)) is { } existing)
                {
                    var itsTarget = RecipeTarget.ForMenuItem(existing.Id);
                    if (sold.Contains(itsTarget))
                    {
                        Skip($"{existing.Name} is on the menu already, as {existing.Id}, and sells by another recipe: link one of them from its recipe card.",
                            $"{existing.Name} في المنيو بكود {existing.Id} وله وصفة أخرى: اربط إحداهما من بطاقة الوصفة.");
                        continue;
                    }
                    recipe.Define(recipe.Name, recipe.RecipeCategoryId, recipe.PlannedPrice, itsTarget);
                    sold.Add(itsTarget);
                    linked.Add(new RecipeOnMenu(recipe.Id, name, existing.Id, existing.Category, existing.Price, false));
                    continue;
                }

                var categoryName = SheetText.Clean(asked.Category);
                if (categoryName is null)
                {
                    Skip("Choose its menu category.", "اختر قسمها في المنيو.");
                    continue;
                }
                if (asked.Price is not { } price || price <= 0)
                {
                    Skip("Give it its selling price, more than nothing.", "اكتب سعر البيع، أكبر من صفر.");
                    continue;
                }

                if (!categories.TryGetValue(MenuKey(categoryName), out var category))
                {
                    category = new MenuCategory(categoryName, null, nextOrder++);
                    menu.AddCategory(category);
                    categories[MenuKey(category.Name)] = category;
                    added.Add(category.Name);
                }

                var item = new MenuItem(next, name, SheetText.Clean(asked.NameAr), category.Name, price, false);
                menu.AddItem(item);
                next++;
                byName[MenuKey(item.Name)] = item;
                var newTarget = RecipeTarget.ForMenuItem(item.Id);
                recipe.Define(recipe.Name, recipe.RecipeCategoryId, recipe.PlannedPrice, newTarget);
                sold.Add(newTarget);
                linked.Add(new RecipeOnMenu(recipe.Id, name, item.Id, category.Name, price, true));
            }
            catch (DomainException error)
            {
                Skip(error.Message, "لم تُضف: راجع السبب بالإنجليزية.");
            }
        }

        if (linked.Count > 0)
            await unitOfWork.SaveChangesAsync(cancellationToken);
        return new RecipesToMenuResult(linked, skipped, added);
    }

    private static string MenuKey(string name) => SheetText.Key(name);

    private static string Code(RecipeTarget target) =>
        target.Kind == RecipeTargetKind.AddOn ? $"A{target.CatalogItemId}" : target.VariantId is { } v ? $"{target.CatalogItemId}-{v}" : $"{target.CatalogItemId}";
}
