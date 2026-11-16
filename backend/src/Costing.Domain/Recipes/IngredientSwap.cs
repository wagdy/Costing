using Costing.Domain.Common;

namespace Costing.Domain.Recipes;

// Swapping one item for another on a recipe (استبدال خامة): the new item's quantity is the old
// one's × the conversion ratio (معامل التحويل), as edible portion in each item's own unit: 100 g of
// Mozzarella A at 0.8 is 80 g of Mozzarella B. 1 unless the chef says otherwise.
public static class IngredientSwap
{
    public const decimal MaxRatio = 1000;

    public static void CheckRatio(decimal ratio)
    {
        if (ratio <= 0 || ratio > MaxRatio)
            throw new DomainException("The conversion ratio is more than 0 and at most 1,000. · معامل التحويل أكبر من صفر وحتى 1000.");
    }

    // To the thousandth of a gram, millilitre or piece, as recipes keep quantities; never nothing.
    public static decimal Quantity(decimal oldQuantity, decimal ratio)
    {
        CheckRatio(ratio);
        var quantity = Math.Round(oldQuantity * ratio, 3, MidpointRounding.AwayFromZero);
        return quantity > 0
            ? quantity
            : throw new DomainException("At that ratio the new quantity rounds to nothing. · الكمية الجديدة تقرب إلى صفر.");
    }
}
