using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Application.Recipes;

// The bulk material swap (معالج الاستبدال الشامل للخامات): in each recipe and prep item chosen, the
// old item's line becomes the new item's, at its quantity × the ratio (IngredientSwap), all saved
// together or none. Costs are worked out from the recipes as they are whenever they are asked
// for, so every dish made with them, directly or through a prep item, is costed by the new item
// from then on. A prep item made already carries the new item from its next batch: what is on the
// shelf was made with the old.
//
// A dish's recipe is anyone's who may write recipes; a prep item's is a manager's (anyone else's
// change waits for one). A record with a request waiting for a manager is left as it is.
public sealed record BulkSwapMaterialCommand(
    Guid FromMaterialId,
    Guid ToMaterialId,
    decimal Ratio,
    IReadOnlyList<Guid>? RecipeIds,
    IReadOnlyList<Guid>? PrepItemIds,
    bool CanApprove = true) : IRequest<BulkSwapResult>;

public sealed record BulkSwapResult(int Recipes, int PrepItems);

public static class BulkSwapRules
{
    // The prep items `start` is made from, itself among them, through every prep item down.
    public static IReadOnlySet<Guid> MadeFrom(Guid start, IReadOnlyDictionary<Guid, PrepRecipe> recipes)
    {
        var seen = new HashSet<Guid>();
        var waiting = new Stack<Guid>([start]);
        while (waiting.TryPop(out var id))
        {
            if (!seen.Add(id) || recipes.GetValueOrDefault(id) is not { } recipe)
                continue;
            foreach (var ingredient in recipe.Ingredients)
                waiting.Push(ingredient.RawMaterialId);
        }
        return seen;
    }

    public const string PrepItemsManagers =
        "A prep item's recipe is changed by a manager: leave the prep items out, or ask a manager. · تعديل وصفة المصنّع للمدير.";

    public static string MadeFromItself(string prepItem, string swappedIn) =>
        $"{prepItem} would be made from itself: {swappedIn} is made with it. · المصنّع سيدخل في تركيبه.";
}

internal sealed class BulkSwapMaterialHandler(
    IRecipeRepository recipes,
    IPrepRecipeRepository prepRecipes,
    IRawMaterialRepository materials,
    IApprovalRequestRepository approvals,
    IUnitOfWork unitOfWork) : IRequestHandler<BulkSwapMaterialCommand, BulkSwapResult>
{
    public async Task<BulkSwapResult> Handle(BulkSwapMaterialCommand request, CancellationToken cancellationToken)
    {
        IngredientSwap.CheckRatio(request.Ratio);
        if (request.FromMaterialId == request.ToMaterialId)
            throw new DomainException("Choose another item to swap in. · اختر خامة مختلفة.");
        var recipeIds = (request.RecipeIds ?? []).Distinct().ToList();
        var prepItemIds = (request.PrepItemIds ?? []).Distinct().ToList();
        if (recipeIds.Count + prepItemIds.Count == 0)
            throw new DomainException("Choose at least one recipe to swap it in. · اختر وصفة واحدة على الأقل.");
        if (prepItemIds.Count > 0 && !request.CanApprove)
            throw new DomainException(BulkSwapRules.PrepItemsManagers);

        var all = (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id);
        var from = all.GetValueOrDefault(request.FromMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), request.FromMaterialId);
        var to = all.GetValueOrDefault(request.ToMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), request.ToMaterialId);
        if (to.IsArchived)
            throw new DomainException($"{to.Name} has been deleted from the raw materials: it cannot go on a recipe.");

        var dishes = (await recipes.GetAllAsync(cancellationToken)).ToDictionary(r => r.Id);
        foreach (var id in recipeIds)
        {
            var recipe = dishes.GetValueOrDefault(id) ?? throw new NotFoundException(nameof(Recipe), id);
            if (recipe.IsDeleted)
                throw new DomainException($"{recipe.Name ?? "A recipe"} is deleted. Restore it to change it.");
            await approvals.EnsureNotPendingAsync(recipe.Id, cancellationToken);
            if (recipe.SwapIngredient(from, to, request.Ratio) is null)
                throw new DomainException($"{recipe.Name ?? "A recipe"} no longer has {from.Name}. Preview the swap again. · أعد المعاينة.");
        }

        // A prep item made with the new item, through any prep item, cannot take it in: it would be
        // made from itself. The whole list read for that; each one changed, read to be saved.
        var inside = to.IsPrepItem
            ? BulkSwapRules.MadeFrom(to.Id, (await prepRecipes.GetAllAsync(cancellationToken)).ToDictionary(r => r.PrepItemId))
            : new HashSet<Guid>();
        foreach (var id in prepItemIds)
        {
            var item = all.GetValueOrDefault(id) ?? throw new NotFoundException(nameof(RawMaterial), id);
            var batch = await prepRecipes.GetByIdAsync(id, cancellationToken) ?? throw new DomainException($"{item.Name} has no recipe to swap in.");
            if (item.IsArchived)
                throw new DomainException($"{item.Name} has been deleted.");
            if (inside.Contains(id))
                throw new DomainException(BulkSwapRules.MadeFromItself(item.Name, to.Name));
            await approvals.EnsureNotPendingAsync(id, cancellationToken);
            if (batch.SwapIngredient(from, to, request.Ratio) is null)
                throw new DomainException($"{item.Name} no longer has {from.Name}. Preview the swap again. · أعد المعاينة.");
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new BulkSwapResult(recipeIds.Count, prepItemIds.Count);
    }
}
