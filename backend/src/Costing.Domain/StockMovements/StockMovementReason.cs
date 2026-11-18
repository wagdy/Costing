namespace Costing.Domain.StockMovements;

public enum StockMovementReason
{
    // An order was paid.
    Sale = 1,

    // An item was voided after it reached the kitchen but before payment.
    Waste = 2,

    // An item was voided after payment, and its ingredients go back on the shelf.
    VoidReturn = 3,

    Purchase = 4,

    CountAdjustment = 5,

    // Raw stock thrown away, recorded by hand: expired, spoiled, dropped, damaged packaging.
    Spoilage = 6,

    // Taken from stock to make a prep item: the flour that went into the dough. A transfer
    // between stock items, not a cost of sales.
    ProductionInput = 7,

    // A prep item made: the dough, into stock at what its ingredients cost.
    ProductionOutput = 8,

    // Stock as found when costing starts (جرد افتتاحي): where it begins, not a shortage or a
    // surplus, so no report counts it as a loss or a gain.
    OpeningStock = 9,

    // Eaten by the staff (وجبات العاملين): a benefit of the staff, in the labor cost, never a loss
    // of the kitchen's.
    StaffMeal = 10,

    // Given to guests on the house (ضيافة وإكراميات): a cost of its own on the P&L.
    Hospitality = 11,

    // Used trying or testing a recipe (تجارب واختبار وصفات): development, not loss.
    RecipeTasting = 12,

    // Moved out of one location of a branch into another (التحويلات الداخلية): the pair nets to
    // nothing for the branch, at its average cost; no cost of the period.
    TransferOut = 13,
    TransferIn = 14,
}

public static class StaffConsumption
{
    // Taken out of stock on purpose, by the staff, for guests or for a recipe being tried: logged,
    // so never part of the unexplained variance, and never spoilage.
    public static readonly StockMovementReason[] Reasons =
        [StockMovementReason.StaffMeal, StockMovementReason.Hospitality, StockMovementReason.RecipeTasting];

    public static bool Is(StockMovementReason reason) => Reasons.Contains(reason);
}
