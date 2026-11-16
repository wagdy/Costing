using Costing.Domain.Common;

namespace Costing.Domain.Sales;

// Why a day's discounts were given (أسباب الخصومات): "Loyalty", "Staff", "Manager promo", with what
// each took off the menu prices (0 when only the reason is known) and on how many bills.
public sealed record DiscountReason(string Reason, decimal Amount = 0, int Count = 0);

// A day's discounts and promos (الخصومات والعروض): what was taken off the menu prices before the cash
// and card were collected. Never collected, so never in the till or the safe; the P&L reads it to
// set the revenue the menu prices would have brought against what was collected.
public static class Discounts
{
    public const int MaxReasons = 20;
    public const int MaxReasonLength = 60;

    // The reasons checked and tidied: none blank or long, each once (the same reason in any case
    // added together, the first spelling kept), at most 20, amounts and counts zero or more, and
    // their amounts together no more than the day's discounts. None without a discount.
    public static IReadOnlyList<DiscountReason> Clean(decimal discounts, IEnumerable<DiscountReason>? reasons)
    {
        if (discounts < 0)
            throw new DomainException("The discounts are zero or more. · الخصومات صفر أو أكثر.");
        var given = (reasons ?? []).Where(r => r is not null).ToList();
        foreach (var reason in given)
        {
            if (string.IsNullOrWhiteSpace(reason.Reason))
                throw new DomainException("Name each discount's reason. · اكتب سبب كل خصم.");
            if (reason.Reason.Trim().Length > MaxReasonLength)
                throw new DomainException($"Keep each reason under {MaxReasonLength} characters. · السبب {MaxReasonLength} حرفًا على الأكثر.");
            if (reason.Amount < 0 || reason.Count < 0)
                throw new DomainException("A reason's amount and count are zero or more. · المبلغ والعدد صفر أو أكثر.");
        }

        var cleaned = given
            .GroupBy(r => r.Reason.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new DiscountReason(g.First().Reason.Trim(), Money(g.Sum(r => r.Amount)), g.Sum(r => r.Count)))
            .ToList();
        if (cleaned.Count > MaxReasons)
            throw new DomainException($"At most {MaxReasons} discount reasons a day. · {MaxReasons} سببًا على الأكثر.");
        if (cleaned.Count > 0 && discounts == 0)
            throw new DomainException("Enter the discounts the reasons are for. · أدخل قيمة الخصومات.");
        if (cleaned.Sum(r => r.Amount) > Money(discounts))
            throw new DomainException("The reasons add up to more than the discounts. · مجموع الأسباب أكبر من الخصومات.");
        return cleaned;
    }

    // The same reasons taken back: what a voided day's reversal carries.
    public static IReadOnlyList<DiscountReason> Negated(IEnumerable<DiscountReason> reasons) =>
        reasons.Select(r => r with { Amount = -r.Amount, Count = -r.Count }).ToList();

    public static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
}
