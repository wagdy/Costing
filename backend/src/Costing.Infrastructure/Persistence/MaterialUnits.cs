using Microsoft.EntityFrameworkCore;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockCounts;

namespace Costing.Infrastructure.Persistence;

// The records naming a bought material, in the unit it is counted in: read to say what a unit
// change restates, and restated, row by row in the database, when it is made. Quantities are divided by
// how many of the old unit one of the new is, costs per unit multiplied, to the columns' places;
// totals of money are not touched.
internal sealed class MaterialUnits(CostingDbContext db) : IMaterialUnits
{
    public async Task<MaterialUsage> UsageAsync(RawMaterial material, Guid? exceptRequestId, CancellationToken cancellationToken)
    {
        var id = material.Id;
        var text = id.ToString();
        // A request waiting for a manager about it, or holding it in what it would make. They are
        // few, and the payload is JSON: read, and looked through here.
        var pending = await db.ApprovalRequests.AsNoTracking()
            .Where(r => r.Status == ApprovalStatus.Pending && r.Id != exceptRequestId)
            .Select(r => new { r.RecordId, r.Payload })
            .ToListAsync(cancellationToken);
        return new MaterialUsage(
            await db.StockMovements.CountAsync(m => m.RawMaterialId == id, cancellationToken),
            await db.Set<PurchaseInvoiceLine>().CountAsync(l => l.RawMaterialId == id, cancellationToken),
            await db.Set<RecipeIngredient>().Where(i => i.RawMaterialId == id).Select(i => i.RecipeId).Distinct().CountAsync(cancellationToken),
            await db.Set<PrepIngredient>().Where(i => i.RawMaterialId == id).Select(i => i.PrepRecipeId).Distinct().CountAsync(cancellationToken),
            await db.Set<StockCountLine>().Where(l => l.RawMaterialId == id).Select(l => l.StockCountId).Distinct().CountAsync(cancellationToken),
            await db.Set<ProductionOrderLine>().Where(l => l.RawMaterialId == id).Select(l => l.ProductionOrderId).Distinct().CountAsync(cancellationToken),
            pending.Count(r => r.RecordId == id || r.Payload?.Contains(text, StringComparison.OrdinalIgnoreCase) == true));
    }

    public async Task RestateAndSaveAsync(RawMaterial material, decimal oneNewIsOld, CancellationToken cancellationToken)
    {
        var (id, r) = (material.Id, oneNewIsOld);
        var unit = material.Unit.ToString();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        await db.StockMovements.Where(m => m.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(m => m.Quantity, m => Math.Round(m.Quantity / r, 3))
            .SetProperty(m => m.UnitCost, m => m.UnitCost * r)
            .SetProperty(m => m.CompanyUnitCost, m => m.CompanyUnitCost * r), cancellationToken);
        await db.Set<PurchaseInvoiceLine>().Where(l => l.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.Quantity, l => Math.Round(l.Quantity / r, 3))
            .SetProperty(l => l.UnitSize, l => Math.Round(l.UnitSize / r, 3)), cancellationToken);
        await db.Set<RecipeIngredient>().Where(i => i.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(i => i.Quantity, i => Math.Round(i.Quantity / r, 3)), cancellationToken);
        await db.Set<PrepIngredient>().Where(i => i.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(i => i.Quantity, i => Math.Round(i.Quantity / r, 3)), cancellationToken);
        await db.Set<StockCountLine>().Where(l => l.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.CountedQuantity, l => Math.Round(l.CountedQuantity / r, 3))
            .SetProperty(l => l.BookQuantity, l => l.BookQuantity == null ? null : Math.Round(l.BookQuantity.Value / r, 3))
            .SetProperty(l => l.UnitCost, l => l.UnitCost * r), cancellationToken);
        await db.Set<ProductionOrderLine>().Where(l => l.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.Quantity, l => Math.Round(l.Quantity / r, 3))
            .SetProperty(l => l.UnitCost, l => l.UnitCost * r), cancellationToken);
        // Each branch's cost, and what was moved between locations, in the new unit too.
        await db.MaterialBranchStocks.Where(b => b.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(b => b.AverageCost, b => b.AverageCost * r)
            .SetProperty(b => b.CompanyAverageCost, b => b.CompanyAverageCost * r), cancellationToken);
        await db.Set<Domain.Stock.InternalTransferLine>().Where(l => l.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.Quantity, l => Math.Round(l.Quantity / r, 3))
            .SetProperty(l => l.UnitCostSnapshot, l => l.UnitCostSnapshot * r)
            .SetProperty(l => l.Unit, unit), cancellationToken);
        // What branches asked for, were sent and received, and at what price.
        await db.Set<Domain.InterBranch.InterBranchRequisitionLine>().Where(l => l.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.RequestedQuantity, l => Math.Round(l.RequestedQuantity / r, 3))
            .SetProperty(l => l.DispatchedQuantity, l => Math.Round(l.DispatchedQuantity / r, 3))
            .SetProperty(l => l.ReceivedQuantity, l => Math.Round(l.ReceivedQuantity / r, 3))
            .SetProperty(l => l.Unit, unit), cancellationToken);
        await db.Set<Domain.InterBranch.InternalSalesInvoiceLine>().Where(l => l.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.Quantity, l => Math.Round(l.Quantity / r, 3))
            .SetProperty(l => l.ReceivedQuantity, l => l.ReceivedQuantity == null ? null : Math.Round(l.ReceivedQuantity.Value / r, 3))
            .SetProperty(l => l.UnitCost, l => l.UnitCost * r)
            .SetProperty(l => l.TransferUnitPrice, l => l.TransferUnitPrice * r)
            .SetProperty(l => l.Unit, unit), cancellationToken);
        await db.Set<Domain.InterBranch.InternalPurchaseInvoiceLine>().Where(l => l.RawMaterialId == id).ExecuteUpdateAsync(s => s
            .SetProperty(l => l.DispatchedQuantity, l => Math.Round(l.DispatchedQuantity / r, 3))
            .SetProperty(l => l.ReceivedQuantity, l => Math.Round(l.ReceivedQuantity / r, 3))
            .SetProperty(l => l.ShortQuantity, l => Math.Round(l.ShortQuantity / r, 3))
            .SetProperty(l => l.TransferUnitPrice, l => l.TransferUnitPrice * r)
            .SetProperty(l => l.Unit, unit), cancellationToken);

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
