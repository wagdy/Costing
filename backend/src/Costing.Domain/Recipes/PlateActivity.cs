using Costing.Domain.Common;

namespace Costing.Domain.Recipes;

// What a plate, or a batch of a prep item, takes of the kitchen's time (معامل وقت وصعوبة التحضير):
// the minutes of work, and how hard that work is against an ordinary minute. The burdened plate
// cost shares the period's labor by them, activity-based: a dish that takes twenty minutes of a
// chef carries more of the wages than a juice poured in one.
//
// PrepTimeMinutes: for one plate of a dish; for one batch of a prep item. Null until it is set: the
// kitchen's ordinary 10 minutes stands in. ComplexityWeight: 1 is an ordinary minute; 1.5 a minute
// of skilled work (a grill station), 0.5 a minute of simple assembly.
public sealed record PlateActivity(decimal? PrepTimeMinutes, decimal ComplexityWeight)
{
    public const decimal DefaultPrepTimeMinutes = 10;
    public const decimal DefaultComplexityWeight = 1;
    public const decimal MaxPrepTimeMinutes = 24 * 60;
    public const decimal MinComplexityWeight = 0.1m;
    public const decimal MaxComplexityWeight = 10;

    public static readonly PlateActivity Default = new(DefaultPrepTimeMinutes, DefaultComplexityWeight);

    // The minutes counted: as set, or the ordinary 10 when not.
    public decimal Minutes => PrepTimeMinutes ?? DefaultPrepTimeMinutes;

    // Minutes weighed by how hard they are: what the labor is shared by.
    public decimal WeightedMinutes => Minutes * ComplexityWeight;

    public static PlateActivity Checked(decimal? prepTimeMinutes, decimal complexityWeight)
    {
        if (prepTimeMinutes is < 0 or > MaxPrepTimeMinutes)
            throw new DomainException("The prep time is minutes between 0 and 1,440 (a day). · وقت التحضير بالدقائق بين 0 و1440.");
        if (complexityWeight is < MinComplexityWeight or > MaxComplexityWeight)
            throw new DomainException("The complexity weight is between 0.1 and 10: 1 is an ordinary minute. · معامل الصعوبة بين 0.1 و10.");
        return new PlateActivity(prepTimeMinutes is { } m ? Math.Round(m, 2, MidpointRounding.AwayFromZero) : null,
            Math.Round(complexityWeight, 2, MidpointRounding.AwayFromZero));
    }
}
