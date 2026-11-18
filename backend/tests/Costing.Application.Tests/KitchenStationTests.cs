using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Application.Stations;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Application.Tests;

// The kitchen and bar stations as a manager keeps them, and the materials, dishes and waste given one.
public class KitchenStationTests
{
    private readonly TestCosting _costing = new();

    [Fact]
    public async Task Stations_are_saved_with_their_own_codes_and_names_counted_and_taken_away()
    {
        var (grill, bar) = (Guid.NewGuid(), Guid.NewGuid());
        await _costing.Send(new SaveKitchenStationCommand(grill, "Grill", "المشويات", "GRILL", 1, null));
        await _costing.Send(new SaveKitchenStationCommand(bar, "Bar & Barista", null, "bar", 2, 2));
        Assert.StartsWith("Another station has the code GRILL", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new SaveKitchenStationCommand(Guid.NewGuid(), "Charcoal", null, " grill ", 3, null)))).Message);
        Assert.StartsWith("There is a station called Grill already", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new SaveKitchenStationCommand(Guid.NewGuid(), "grill", null, null, 3, null)))).Message);

        var beef = _costing.Inventory.Stock("Beef", UnitOfMeasure.Gram, 5_000);
        var coffee = _costing.Inventory.Stock("Coffee beans", UnitOfMeasure.Gram, 2_000);
        Assert.Equal(2, await _costing.Send(new AssignMaterialStationCommand([beef.Id, coffee.Id], grill)));
        await _costing.Send(new AssignMaterialStationCommand([coffee.Id], bar));
        var recipe = await _costing.Send(new SetRecipeCommand(RecipeTargetKind.MenuItem, TestCosting.Burger, null, [new(beef.Id, 150)]));
        Assert.Equal(grill, await _costing.Send(new AssignRecipeStationCommand(recipe.Id, grill)));

        var listed = await _costing.Send(new GetKitchenStationsQuery());
        Assert.Equal([("Grill", 1, 1, (decimal?)null), ("Bar & Barista", 1, 0, 2m)],
            listed.Select(s => (s.Name, s.Materials, s.Recipes, s.TargetVarianceTolerancePercent)));

        // Out of use: nothing more given to it.
        await _costing.Send(new SaveKitchenStationCommand(bar, "Bar & Barista", null, "BAR", 2, 2, IsActive: false));
        Assert.StartsWith("Bar & Barista is not in use", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new AssignMaterialStationCommand([beef.Id], bar)))).Message);
        Assert.StartsWith("That station is no longer on the list", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new AssignMaterialStationCommand([beef.Id], Guid.NewGuid())))).Message);

        // Taken away: what it kept has none (the shared station's).
        await _costing.Send(new DeleteKitchenStationCommand(grill));
        Assert.Equal((null, null), (beef.KitchenStationId, (await _costing.Inventory.Recipes.GetByIdAsync(recipe.Id))!.KitchenStationId));
        Assert.Equal(["Bar & Barista"], (await _costing.Send(new GetKitchenStationsQuery())).Select(s => s.Name));
    }

    [Fact]
    public async Task Spoilage_is_held_against_the_station_named_or_the_materials_own()
    {
        var (cold, hot) = (Guid.NewGuid(), Guid.NewGuid());
        await _costing.Send(new SaveKitchenStationCommand(cold, "Cold & Salads", null, "COLD", 1, null));
        await _costing.Send(new SaveKitchenStationCommand(hot, "Hot Kitchen", null, "HOT", 2, null));
        var lettuce = _costing.Inventory.Stock("Lettuce", UnitOfMeasure.Gram, 5_000);
        await _costing.Send(new AssignMaterialStationCommand([lettuce.Id], cold));

        await _costing.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new(lettuce.Id, 100, "Wilted")], "Omar"));
        await _costing.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new(lettuce.Id, 200, "Left out", hot)], "Omar"));
        Assert.Equal([cold, hot], _costing.Inventory.Movements.All.Select(m => m.ResponsibleStationId));
        Assert.StartsWith("That station is no longer on the list", (await Assert.ThrowsAsync<DomainException>(() =>
            _costing.Send(new RecordSpoilageCommand(Guid.NewGuid(), [new(lettuce.Id, 100, "Dropped", Guid.NewGuid())], "Omar")))).Message);
    }

    [Fact]
    public async Task The_raw_materials_sheet_gives_each_material_its_station_by_name_arabic_name_or_code()
    {
        var (grill, bar) = (Guid.NewGuid(), Guid.NewGuid());
        await _costing.Send(new SaveKitchenStationCommand(grill, "Grill", "المشويات", "GRILL", 1, null));
        await _costing.Send(new SaveKitchenStationCommand(bar, "Bar & Barista", "البار والباريستا", "BAR", 2, null));
        var result = await _costing.Send(new ImportRawMaterialsCommand(
        [
            new RawMaterialSheetRow(2, "Beef", "Meat", "Kg", "300", Station: "grill"),
            new RawMaterialSheetRow(3, "Coffee beans", "Dry goods", "Kg", "500", Station: "البار والباريستا"),
            new RawMaterialSheetRow(4, "Milk", "Dairy", "Liter", "40", Station: "BAR"),
            new RawMaterialSheetRow(5, "Ice", "Dry goods", "Kg", "5", Station: "Freezer"),
        ]));
        Assert.Equal(3, result.Created.Count);
        Assert.Equal((5, "No station in use called Freezer: choose one from the list, or add it on Cost settings."),
            (result.Skipped.Single().Row, result.Skipped.Single().Reason));
        var materials = await _costing.Inventory.GetAllAsync();
        Assert.Equal([("Beef", (Guid?)grill), ("Coffee beans", bar), ("Milk", bar)], materials.Select(m => (m.Name, m.KitchenStationId)).OrderBy(m => m.Name));

        // Changed by a later sheet: the station is one more thing changed; blank leaves it.
        var again = await _costing.Send(new ImportRawMaterialsCommand(
            [new RawMaterialSheetRow(2, "Beef", null, null, null, Station: "Bar & Barista"), new RawMaterialSheetRow(3, "Milk", null, null, null)]));
        Assert.Equal(["Station"], again.Updated.Single().Changes);
        Assert.Equal(1, again.Unchanged);
        var sheet = await _costing.Send(new GetRawMaterialSheetQuery());
        Assert.Equal(["Bar & Barista", "Bar & Barista", "Bar & Barista"], sheet.Lines.Select(l => l.Station));
        Assert.Equal(["Grill", "Bar & Barista"], sheet.Stations);
    }
}
