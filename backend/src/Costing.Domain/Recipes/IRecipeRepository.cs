using Costing.Domain.Common;

namespace Costing.Domain.Recipes;

// Returns recipes with their Ingredients loaded. Nothing removes one: a deleted recipe is marked so.
public interface IRecipeRepository : IRepository<Recipe>
{
    // Every recipe, on the menu or off it, the deleted ones too: a recipes sheet is written from
    // them and read back against them.
    Task<IReadOnlyList<Recipe>> GetAllAsync(CancellationToken cancellationToken = default);

    // The active recipe linked to the target, if any.
    Task<Recipe?> GetByTargetAsync(RecipeTarget target, CancellationToken cancellationToken = default);

    // Every active recipe a set of sold items could need, in one round trip (see
    // StockRequirements.TargetsFor). Targets with no recipe are simply absent.
    Task<IReadOnlyList<Recipe>> GetByTargetsAsync(IReadOnlyCollection<RecipeTarget> targets, CancellationToken cancellationToken = default);

    // Every recipe in the category, the deleted ones too: what moves with it when it goes.
    Task<IReadOnlyList<Recipe>> GetInCategoryAsync(Guid categoryId, CancellationToken cancellationToken = default);

    // How many active recipes each category holds.
    Task<IReadOnlyDictionary<Guid, int>> CountByCategoryAsync(CancellationToken cancellationToken = default);

    // How many recipes not deleted, on the menu or off it, have the material as an ingredient.
    Task<int> CountUsingAsync(Guid rawMaterialId, CancellationToken cancellationToken = default);
}
