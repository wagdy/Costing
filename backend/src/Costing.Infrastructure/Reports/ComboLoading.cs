using Microsoft.EntityFrameworkCore;
using Costing.Domain.Recipes;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Reports;

internal static class ComboLoading
{
    // What each combo is made of, by the menu number it is sold under, deleted ones too (their
    // sales still took stock by them): for StockRequirements.For.
    public static async Task<IReadOnlyDictionary<int, IReadOnlyList<ComboPart>>> ComboPartsAsync(this CostingDbContext db, CancellationToken cancellationToken) =>
        (await db.ComboOffers.AsNoTracking().ToListAsync(cancellationToken)).ToDictionary(c => c.Code, c => c.Parts);
}
