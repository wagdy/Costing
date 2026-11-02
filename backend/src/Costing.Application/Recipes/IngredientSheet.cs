using System.Globalization;
using System.Text.RegularExpressions;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.RawMaterials;

namespace Costing.Application.Recipes;

// An ingredient as a recipes or prep items sheet offers it, in its dropdown: by its label, which
// says the unit its quantity is written in, "Flour (Kg)", and "Pizza dough · مصنّع (Kg)" for a
// prep item. The quantity is in kg, litres or pieces, never grams: 0.2 for 200 g.
public sealed record SheetIngredient(string Label, string Name, string? Code, bool IsPrepItem, string Unit, string UnitAr);

// What a recipe or a prep item costs now, by its ingredients at their average costs: its whole
// recipe or batch, and one portion or one kg, litre or piece of it ("portion", "Kg"). An
// ingredient with no price yet is named, and leaves the cost short of it. Notes: what to check,
// such as a quantity that reads as grams written as kilos.
public sealed record CostedSheetItem(
    int Row, string Name, int Ingredients, decimal? Cost, decimal? CostPer, string Per, IReadOnlyList<string> MissingPrices,
    IReadOnlyList<string> Notes, bool Requested = false);

// One line read: the material it names, in its own unit, or why not.
internal sealed record SheetLine(int Row, RawMaterial? Material, decimal Quantity, string? Reason, string? ReasonAr);

// The materials and prep items a sheet's ingredient cells are read against: by their label as the
// dropdown writes it, by name, or by code, the unit in brackets checked against the material's.
internal sealed partial class IngredientLookup
{
    public const string PrepMark = "مصنّع";

    private readonly Dictionary<string, RawMaterial> _byLabel = [];
    private readonly Dictionary<string, List<RawMaterial>> _byName = [];
    private readonly Dictionary<string, RawMaterial> _byCode = [];
    private readonly Dictionary<string, RawMaterial> _deleted = [];
    private readonly Dictionary<Guid, string> _labels = [];

    public IngredientLookup(IEnumerable<RawMaterial> materials)
    {
        var all = materials.ToList();
        var live = all.Where(m => !m.IsArchived)
            .OrderBy(m => m.IsPrepItem)
            .ThenBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        var named = live.GroupBy(m => SheetText.Key(m.Name)).ToDictionary(g => g.Key, g => g.Count());
        var offered = new List<SheetIngredient>();
        foreach (var material in live)
        {
            // Two of one name are told apart by their codes, or else by a number.
            var label = Label(material, named[SheetText.Key(material.Name)] > 1 ? material.Code : null);
            for (var n = 2; _byLabel.ContainsKey(SheetText.Key(label)); n++)
                label = Label(material, $"{material.Code ?? ""}#{n}".TrimStart('#'));
            _byLabel[SheetText.Key(label)] = material;
            _labels[material.Id] = label;
            if (!_byName.TryGetValue(SheetText.Key(material.Name), out var same))
                _byName[SheetText.Key(material.Name)] = same = [];
            same.Add(material);
            if (material.Code is { } code)
                _byCode.TryAdd(SheetText.Key(code), material);
            offered.Add(new SheetIngredient(label, material.Name, material.Code, material.IsPrepItem, SheetUnits.Name(material.Unit), SheetUnits.NameAr(material.Unit)));
        }

        foreach (var material in all.Where(m => m.IsArchived))
            _deleted.TryAdd(SheetText.Key(material.Name), material);
        Offered = offered;
    }

    // In the dropdown's order: the bought materials, then the prep items, each by name.
    public IReadOnlyList<SheetIngredient> Offered { get; }

    public static string Label(RawMaterial material, string? tellApart = null) =>
        $"{material.Name}{(tellApart is null ? "" : $" [{tellApart}]")}{(material.IsPrepItem ? $" · {PrepMark}" : "")} ({SheetUnits.Name(material.Unit)})";

    // As the sheet writes it; one deleted since keeps its plain label.
    public string LabelOf(RawMaterial material) => _labels.GetValueOrDefault(material.Id) ?? Label(material);

    // The material a cell names, and the quantity written beside it in its own unit: a kg of a
    // material counted in grams is 1000 of them.
    public SheetLine Read(int row, string? ingredient, string? quantity)
    {
        var text = SheetText.Clean(ingredient);
        if (text is null)
            return new SheetLine(row, null, 0, "No ingredient: choose it from the list.", "لا يوجد مكوّن: اختره من القائمة.");
        var (material, reason, reasonAr) = Find(text);
        if (material is null)
            return new SheetLine(row, null, 0, reason, reasonAr);

        var written = SheetText.Clean(quantity);
        var unit = SheetUnits.Name(material.Unit);
        var unitAr = SheetUnits.NameAr(material.Unit);
        if (written is null)
            return new SheetLine(row, material, 0, $"No quantity of {material.Name}: write it in {unit}.", $"لا توجد كمية لـ {material.Name}: اكتبها بالـ{unitAr}.");
        if (SheetText.Amount(written) is not { } amount)
            return new SheetLine(row, material, 0, $"\"{written}\" is not a quantity: write a number of {unit}, such as 0.25.",
                $"\"{written}\" ليست كمية: اكتب رقمًا بالـ{unitAr}، مثل 0.25.");
        if (amount <= 0)
            return new SheetLine(row, material, 0, $"The quantity of {material.Name} is more than nothing.", $"كمية {material.Name} يجب أن تكون أكبر من صفر.");
        return new SheetLine(row, material, amount * SheetUnits.Factor(material.Unit), null, null);
    }

    // By its label, its code in brackets or on its own, or its name; then the unit in brackets
    // checked: a quantity is never written in grams here, nor in another unit than its own.
    private (RawMaterial? Material, string? Reason, string? ReasonAr) Find(string text)
    {
        if (_byLabel.TryGetValue(SheetText.Key(text), out var labelled))
            return (labelled, null, null);

        var name = text;
        string? unitText = null;
        if (Bracketed().Match(name) is { Success: true } unitMatch && (SheetUnits.Parse(unitMatch.Groups["unit"].Value) is not null || IsSmallUnit(unitMatch.Groups["unit"].Value)))
        {
            unitText = unitMatch.Groups["unit"].Value.Trim();
            name = unitMatch.Groups["name"].Value.Trim();
        }
        name = PrepSuffix().Replace(name, "").Trim();
        string? code = null;
        if (Coded().Match(name) is { Success: true } codeMatch)
        {
            code = codeMatch.Groups["code"].Value.Trim();
            name = codeMatch.Groups["name"].Value.Trim();
        }

        RawMaterial? found = null;
        if (code is not null)
            found = _byCode.GetValueOrDefault(SheetText.Key(code));
        found ??= _byCode.GetValueOrDefault(SheetText.Key(name));
        if (found is null && _byName.TryGetValue(SheetText.Key(name), out var named))
        {
            if (named.Count > 1)
                return (null, $"More than one material is called {name}: choose the one you mean from the list.",
                    $"يوجد أكثر من خامة باسم {name}: اختر المقصودة من القائمة.");
            found = named[0];
        }

        if (found is null)
            return _deleted.TryGetValue(SheetText.Key(name), out var deleted)
                ? (null, $"{deleted.Name} has been deleted from the raw materials: choose another.", $"{deleted.Name} محذوفة من الخامات: اختر غيرها.")
                : (null, $"\"{name}\" is not a raw material or a prep item: choose it from the list, or add it on Raw materials first.",
                    $"\"{name}\" ليست خامة ولا صنفًا مُصنَّعًا: اخترها من القائمة، أو أضفها في الخامات أولًا.");

        if (unitText is not null && (IsSmallUnit(unitText) || SheetUnits.Parse(unitText) != found.Unit))
            return (null,
                $"{found.Name} is written in {SheetUnits.Name(found.Unit)} on this sheet, not in {unitText}: choose it from the list and write 0.2 for 200 g.",
                $"{found.Name} تُكتب بالـ{SheetUnits.NameAr(found.Unit)} في هذا الملف وليس بـ{unitText}: اخترها من القائمة واكتب 0.2 لـ 200 جرام.");
        return (found, null, null);
    }

    // Grams and millilitres: the sheet writes kilos and litres.
    private static bool IsSmallUnit(string text) =>
        SheetText.Key(text).TrimEnd('.') is "G" or "GM" or "GR" or "GRAM" or "GRAMS" or "ML" or "جرام" or "جم" or "غرام" or "جرامات" or "مل" or "ملي" or "ملليلتر";

    [GeneratedRegex(@"^(?<name>.+?)\s*\((?<unit>[^()]+)\)\s*$")]
    private static partial Regex Bracketed();

    [GeneratedRegex(@"\s*·\s*(مصنّع|مصنع|prep)\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex PrepSuffix();

    [GeneratedRegex(@"^(?<name>.+?)\s*\[(?<code>[^\[\]]+)\]\s*$")]
    private static partial Regex Coded();
}

internal static class SheetNumbers
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // A quantity in the sheet's unit, as written out: 150 g is 0.15.
    public static decimal InSheetUnit(decimal quantity, UnitOfMeasure unit) => Math.Round(quantity / SheetUnits.Factor(unit), 6);

    public static string Plain(decimal value) => value.ToString("0.######", Invariant);

    public static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
}
