using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;
using Costing.Domain.Access;

namespace Costing.Api.Tests;

// Costing & Financials through the API: who works which section, the menu and its sales taking
// stock by recipe, refunds and voids, the sheets imported, the staff the safe pays, breakage, and
// the cost reports read from it all.
public class CostingApiTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(Cancel)}");
        return await response.Content.ReadFromJsonAsync<JsonElement>(Cancel);
    }

    private static string Iso(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static async Task<DateOnly> TodayAsync(HttpClient client) =>
        DateOnly.Parse((await Json(await client.GetAsync("/api/financials/today", Cancel))).GetProperty("today").GetString()!, CultureInfo.InvariantCulture);

    private static async Task<decimal> OnHandAsync(HttpClient client, Guid material) =>
        (await Json(await client.GetAsync("/api/inventory/raw-materials", Cancel))).EnumerateArray()
            .Single(m => m.GetProperty("id").GetGuid() == material).GetProperty("quantityOnHand").GetDecimal();

    // The pizza on the menu: 6101 at 140, a large at 180, cheese at 15 on it; its recipe 150 g of
    // mozzarella at 300 a kilo, the cheese 30 g.
    private static async Task<(Guid Mozzarella, int Large, int Cheese)> PizzaAsync(HttpClient manager)
    {
        await Json(await manager.PostAsJsonAsync("/api/menu/categories", new { name = "Pizza", nameAr = "بيتزا" }, Cancel));
        var cheese = (await Json(await manager.PostAsJsonAsync("/api/menu/add-ons", new { name = "Extra cheese", price = 15 }, Cancel))).GetProperty("id").GetInt32();
        var pizza = await Json(await manager.PostAsJsonAsync("/api/menu/items", new
        {
            number = 6101, name = "Margherita", nameAr = "مارجريتا", category = "Pizza", price = 140, isPriceBasedOnAddons = false,
            sizes = new[] { new { name = "Large", nameAr = "كبير", price = 180 } }, addOnIds = new[] { cheese },
        }, Cancel));
        var mozzarella = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Mozzarella", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000, costPerPurchaseUnit = 300,
        }, Cancel))).GetProperty("id").GetGuid();
        await Json(await manager.PostAsJsonAsync("/api/inventory/purchases", new
        {
            purchaseId = Guid.NewGuid(), lines = new[] { new { rawMaterialId = mozzarella, quantity = 5000 } },
        }, Cancel));
        var category = Guid.NewGuid();
        await Json(await manager.PutAsJsonAsync($"/api/inventory/recipe-categories/{category}", new { name = "Pizza" }, Cancel));
        await Json(await manager.PostAsJsonAsync("/api/inventory/recipes", new
        {
            targetKind = "MenuItem", catalogItemId = 6101, portions = 1, recipeCategoryId = category,
            ingredients = new[] { new { rawMaterialId = mozzarella, quantity = 150 } },
        }, Cancel));
        await Json(await manager.PostAsJsonAsync("/api/inventory/recipes", new
        {
            targetKind = "AddOn", catalogItemId = cheese, portions = 1, recipeCategoryId = category,
            ingredients = new[] { new { rawMaterialId = mozzarella, quantity = 30 } },
        }, Cancel));
        return (mozzarella, pizza.GetProperty("sizes")[0].GetProperty("id").GetInt32(), cheese);
    }

    [Fact]
    public async Task Each_role_works_its_own_sections_and_a_manager_ticks_anyones()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.UserAsync(manager, "Mona", UserRole.Accountant);
        var controller = await api.UserAsync(manager, "Karim", UserRole.CostController);
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);

        async Task<HttpStatusCode> Get(HttpClient client, string path) => (await client.GetAsync(path, Cancel)).StatusCode;
        async Task<string[]> Tabs(HttpClient client) =>
            (await Json(await client.GetAsync("/api/auth/me", Cancel))).GetProperty("tabs").EnumerateArray().Select(t => t.GetString()!).ToArray();

        Assert.Equal(12, (await Tabs(manager)).Length);
        Assert.Equal(["Materials", "Production", "Purchases", "Counts", "Waste"], await Tabs(storekeeper));

        // The safe: the accountant's and a manager's; not the storekeeper's nor the cost controller's.
        Assert.Equal(HttpStatusCode.OK, await Get(accountant, "/api/financials/safe?year=2026&month=10"));
        Assert.Equal(HttpStatusCode.Forbidden, await Get(storekeeper, "/api/financials/safe?year=2026&month=10"));
        Assert.Equal(HttpStatusCode.Forbidden, await Get(controller, "/api/financials/safe?year=2026&month=10"));
        // Production: the cost controller's, not the accountant's (who reads the recipes' costs in Reports).
        Assert.Equal(HttpStatusCode.OK, await Get(controller, "/api/inventory/production-orders"));
        Assert.Equal(HttpStatusCode.Forbidden, await Get(accountant, "/api/inventory/production-orders"));
        Assert.Equal(HttpStatusCode.OK, await Get(accountant, "/api/costing/recipes"));
        // Everyone's materials list; the counts the storekeeper's.
        Assert.Equal(HttpStatusCode.OK, await Get(storekeeper, "/api/inventory/raw-materials"));
        Assert.Equal(HttpStatusCode.OK, await Get(storekeeper, "/api/inventory/stock-counts"));

        // Who works which: a manager's to see and give.
        Assert.Equal(HttpStatusCode.Forbidden, await Get(accountant, "/api/access"));
        var access = (await Json(await manager.GetAsync("/api/access", Cancel))).EnumerateArray().ToList();
        Assert.Equal(["Karim", "Mona", "Samir"], access.Select(a => a.GetProperty("name").GetString()));
        Assert.All(access, a => Assert.False(a.GetProperty("restricted").GetBoolean()));

        // The storekeeper given the counts alone: the purchases closed to them at once.
        var samir = api.UserIds["samir@example.com"];
        var set = await Json(await manager.PutAsJsonAsync($"/api/access/{samir}", new { tabs = new[] { "Counts" } }, Cancel));
        Assert.True(set.GetProperty("restricted").GetBoolean());
        Assert.Equal(["Counts"], await Tabs(storekeeper));
        Assert.Equal(HttpStatusCode.Forbidden, await Get(storekeeper, "/api/inventory/purchase-invoices"));
        Assert.Equal(HttpStatusCode.OK, await Get(storekeeper, "/api/inventory/stock-counts"));

        // Back to the role's own.
        Assert.False((await Json(await manager.PutAsJsonAsync($"/api/access/{samir}", new { tabs = (string[]?)null }, Cancel))).GetProperty("restricted").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, await Get(storekeeper, "/api/inventory/purchase-invoices"));

        // A manager's own sections are not given.
        var boss = (await Json(await manager.GetAsync("/api/users", Cancel))).EnumerateArray().Single(u => u.GetProperty("role").GetString() == "Manager");
        Assert.Equal(HttpStatusCode.UnprocessableEntity,
            (await manager.PutAsJsonAsync($"/api/access/{boss.GetProperty("id").GetString()}", new { tabs = new[] { "Sales" } }, Cancel)).StatusCode);
    }

    [Fact]
    public async Task A_sale_takes_its_stock_by_recipe_a_refund_puts_back_its_share_and_a_void_waits_for_a_manager()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        var (mozzarella, large, cheese) = await PizzaAsync(manager);
        var today = await TodayAsync(manager);

        object Sale(Guid id, string reference) => new
        {
            id, reference, date = Iso(today), time = "13:00:00", channel = "DineIn", paymentMethod = "Cash", taxAmount = 64.4m,
            lines = new object[]
            {
                new { menuItemId = 6101, variantId = large, quantity = 2, addOnIds = new[] { cheese } },
                new { menuItemId = 6101, variantId = large, quantity = 1, voided = "AfterKitchen" },
            },
        };

        // Not the storekeeper's section.
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.PostAsJsonAsync("/api/sales", Sale(Guid.NewGuid(), "R-0"), Cancel)).StatusCode);

        // Two large with cheese (2 × 195) and one made and dropped: 180 g each for two, 150 g wasted.
        var id = Guid.NewGuid();
        var sale = await Json(await accountant.PostAsJsonAsync("/api/sales", Sale(id, "R-1"), Cancel));
        Assert.Equal((390m, 454.4m), (sale.GetProperty("subtotal").GetDecimal(), sale.GetProperty("totalAmount").GetDecimal()));
        Assert.Equal(5_000m - 360 - 150, await OnHandAsync(manager, mozzarella));
        // The same receipt number again is refused; the same sale again is the one recorded.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await accountant.PostAsJsonAsync("/api/sales", Sale(Guid.NewGuid(), "R-1"), Cancel)).StatusCode);
        Assert.Equal(id, (await Json(await accountant.PostAsJsonAsync("/api/sales", Sale(id, "R-1"), Cancel))).GetProperty("id").GetGuid());

        // One of the two handed back: half the line's share of what was charged, its 180 g back.
        var line = sale.GetProperty("lines")[0].GetProperty("publicId").GetGuid();
        var refunded = await Json(await accountant.PostAsJsonAsync($"/api/sales/{id}/refund", new { linePublicId = line, quantity = 1 }, Cancel));
        Assert.Equal(227.2m, refunded.GetProperty("refundedAmount").GetDecimal());
        Assert.Equal(5_000m - 180 - 150, await OnHandAsync(manager, mozzarella));

        var report = await Json(await manager.GetAsync($"/api/sales?from={Iso(today)}&to={Iso(today)}", Cancel));
        Assert.Equal((1, 1, 454.4m, 227.2m), (report.GetProperty("totals").GetProperty("receipts").GetInt32(), report.GetProperty("totals").GetProperty("items").GetInt32(),
            report.GetProperty("totals").GetProperty("total").GetDecimal(), report.GetProperty("totals").GetProperty("refunded").GetDecimal()));

        // The theoretical cost counts the one still sold: 180 g at 300 a kilo, 54.
        var theoretical = await Json(await manager.GetAsync($"/api/costing/theoretical?year={today.Year}&month={today.Month}", Cancel));
        var row = theoretical.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("itemCode").GetString() == $"6101-{large}");
        Assert.Equal((1m, 54m), (row.GetProperty("quantitySold").GetDecimal(), row.GetProperty("theoreticalCost").GetDecimal()));

        // The accountant's void waits; the manager's approval puts everything back.
        var asked = await accountant.PostAsJsonAsync("/api/inventory/deletion-requests", new { requestId = Guid.NewGuid(), module = "Sale", recordId = id, reason = "Wrong day" }, Cancel);
        Assert.Equal(HttpStatusCode.Accepted, asked.StatusCode);
        var request = (await asked.Content.ReadFromJsonAsync<JsonElement>(Cancel)).GetProperty("request");
        Assert.StartsWith("Sale R-1 · ", request.GetProperty("summary").GetString());
        Assert.Equal(5_000m - 180 - 150, await OnHandAsync(manager, mozzarella));
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.PostAsync($"/api/inventory/approval-requests/{request.GetProperty("id").GetGuid()}/approve", null, Cancel)).StatusCode);
        await Json(await manager.PostAsync($"/api/inventory/approval-requests/{request.GetProperty("id").GetGuid()}/approve", null, Cancel));
        Assert.Equal(5_000m, await OnHandAsync(manager, mozzarella));
        Assert.Equal(0, (await Json(await manager.GetAsync($"/api/sales?from={Iso(today)}&to={Iso(today)}", Cancel))).GetProperty("totals").GetProperty("receipts").GetInt32());
    }

    private static MultipartFormDataContent Sheet(XLWorkbook workbook, string name)
    {
        var stream = new MemoryStream();
        workbook.SaveAs(stream);
        var file = new ByteArrayContent(stream.ToArray());
        file.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        return new MultipartFormDataContent { { file, "file", name } };
    }

    [Fact]
    public async Task The_menu_and_its_sales_come_in_from_their_templates_filled_in()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var today = await TodayAsync(manager);

        // The menu's template, filled in and imported.
        var template = await manager.GetAsync("/api/menu/template", Cancel);
        Assert.Equal("menu-template.xlsx", template.Content.Headers.ContentDisposition!.FileNameStar ?? template.Content.Headers.ContentDisposition.FileName);
        using (var menu = new XLWorkbook(await template.Content.ReadAsStreamAsync(Cancel)))
        {
            var sheet = menu.Worksheet("Menu");
            object[][] rows =
            [
                [6201, "Cheese crepe", "كريب جبنة", "Crepes", "كريب", 95, "", "", ""],
                [6301, "Mixed grill", "", "Grill", "", 0, "Half kilo", "نص كيلو", 260],
                [6301, "Mixed grill", "", "", "", "", "Kilo", "كيلو", 500],
            ];
            for (var r = 0; r < rows.Length; r++)
                for (var c = 0; c < rows[r].Length; c++)
                    sheet.Cell(r + 2, c + 1).Value = XLCellValue.FromObject(rows[r][c]);
            var imported = await Json(await manager.PostAsync("/api/menu/import", Sheet(menu, "menu.xlsx"), Cancel));
            Assert.Equal((2, 2), (imported.GetProperty("added").GetInt32(), imported.GetProperty("categoriesAdded").GetInt32()));
        }

        var items = (await Json(await manager.GetAsync("/api/menu", Cancel))).GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("id").GetInt32());
        Assert.Equal(["Half kilo", "Kilo"], items[6301].GetProperty("sizes").EnumerateArray().Select(s => s.GetProperty("name").GetString()));

        // The sales' template: a receipt of two lines, a day's totals, and a row naming nothing on the menu.
        using (var sales = new XLWorkbook(await (await manager.GetAsync("/api/sales/template", Cancel)).Content.ReadAsStreamAsync(Cancel)))
        {
            var sheet = sales.Worksheet("Sales");
            object[][] rows =
            [
                ["R-77", Iso(today), "20:15", "Delivery", "Visa", 6201, "", "", 2, 190, 0, 20, 29.4, 0, 0, ""],
                ["R-77", Iso(today), "20:15", "Delivery", "Visa", "Mixed grill", "Kilo", "", 1, "", "", "", "", "", "", ""],
                ["", Iso(today), "", "", "", 6201, "", "", 10, 950, "", "", "", "", "", ""],
                ["R-78", Iso(today), "21:00", "", "", "Shawarma", "", "", 1, "", "", "", "", "", "", ""],
            ];
            for (var r = 0; r < rows.Length; r++)
                for (var c = 0; c < rows[r].Length; c++)
                    sheet.Cell(r + 2, c + 1).Value = XLCellValue.FromObject(rows[r][c]);
            var imported = await Json(await manager.PostAsync("/api/sales/import", Sheet(sales, "sales.xlsx"), Cancel));
            Assert.Equal((2, 3), (imported.GetProperty("receipts").GetInt32(), imported.GetProperty("lines").GetInt32()));
            var skipped = imported.GetProperty("skipped").EnumerateArray().Single();
            Assert.Equal((5, "There is no Shawarma on the menu: add it on Menu, or check its number."),
                (skipped.GetProperty("row").GetInt32(), skipped.GetProperty("reason").GetString()));

            // Imported again: the numbered receipt is there already.
            Assert.Equal(1, (await Json(await manager.PostAsync("/api/sales/import", Sheet(sales, "sales.xlsx"), Cancel))).GetProperty("alreadyRecorded").GetInt32());
        }

        var report = await Json(await manager.GetAsync($"/api/sales?from={Iso(today)}&to={Iso(today)}", Cancel));
        var r77 = report.GetProperty("receipts").EnumerateArray().Single(r => r.GetProperty("reference").GetString() == "R-77");
        Assert.Equal((690m, 739.4m, "Delivery", "Visa"), (r77.GetProperty("subtotal").GetDecimal(), r77.GetProperty("totalAmount").GetDecimal(),
            r77.GetProperty("channel").GetString(), r77.GetProperty("paymentMethod").GetString()));
    }

    [Fact]
    public async Task The_safe_pays_the_staff_and_breakage_is_entered_on_waste_and_voided_by_a_manager()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var accountant = await api.AccountantAsync(manager);
        var today = await TodayAsync(manager);
        var hassan = Guid.NewGuid();
        await Json(await accountant.PutAsJsonAsync($"/api/staff/{hassan}", new { name = "Hassan", jobTitle = "Chef" }, Cancel));
        await Json(await manager.PostAsJsonAsync("/api/financials/vouchers", new
        {
            requestId = Guid.NewGuid(), transactionId = Guid.NewGuid(), kind = "OpeningBalance", amount = 5_000, date = Iso(today), source = "CarriedOver",
        }, Cancel));

        // An advance to Hassan, against this month's pay; a salary for last month.
        var month = new DateOnly(today.Year, today.Month, 1);
        await Json(await manager.PostAsJsonAsync("/api/financials/vouchers", new
        {
            requestId = Guid.NewGuid(), transactionId = Guid.NewGuid(), kind = "EmployeeAdvance", amount = 300, date = Iso(today), employeeId = hassan,
        }, Cancel));
        await Json(await manager.PostAsJsonAsync("/api/financials/vouchers", new
        {
            requestId = Guid.NewGuid(), transactionId = Guid.NewGuid(), kind = "SalaryPayment", amount = 4_000, date = Iso(today), employeeId = hassan,
            payrollMonth = Iso(month.AddMonths(-1)),
        }, Cancel));
        var advances = (await Json(await manager.GetAsync($"/api/financials/advances?from={Iso(month)}&to={Iso(today)}", Cancel))).EnumerateArray().Single();
        Assert.Equal(("Hassan", 300m, Iso(month)), (advances.GetProperty("employee").GetString(), advances.GetProperty("amount").GetDecimal(),
            advances.GetProperty("payrollMonth").GetString()));

        // Left: off the list for new entries.
        await Json(await manager.PutAsJsonAsync($"/api/staff/{hassan}", new { name = "Hassan", jobTitle = "Chef", isActive = false }, Cancel));
        var refused = await manager.PostAsJsonAsync("/api/financials/vouchers", new
        {
            requestId = Guid.NewGuid(), transactionId = Guid.NewGuid(), kind = "EmployeeAdvance", amount = 100, date = Iso(today), employeeId = hassan,
        }, Cancel);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        Assert.Contains("has left", await refused.Content.ReadAsStringAsync(Cancel));

        // Six plates broken, at 45 each: on Waste (the storekeeper's, not the accountant's), and
        // voided only on a manager's say.
        var storekeeper = await api.UserAsync(manager, "Samir", UserRole.Storekeeper);
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.PostAsJsonAsync("/api/costing/breakage", new
        {
            id = Guid.NewGuid(), date = Iso(today), description = "Dinner plate", quantity = 6, unitCost = 45,
        }, Cancel)).StatusCode);
        var broken = await Json(await storekeeper.PostAsJsonAsync("/api/costing/breakage", new
        {
            id = Guid.NewGuid(), date = Iso(today), description = "Dinner plate", quantity = 6, unitCost = 45, employeeId = hassan, notes = "Dropped tray",
        }, Cancel));
        Assert.Equal((270m, "Hassan"), (broken.GetProperty("cost").GetDecimal(), broken.GetProperty("employeeName").GetString()));
        var listed = (await Json(await manager.GetAsync("/api/costing/breakage?days=7", Cancel))).EnumerateArray().Single();
        Assert.False(listed.GetProperty("isVoided").GetBoolean());
        var asked = await storekeeper.PostAsJsonAsync("/api/inventory/deletion-requests",
            new { requestId = Guid.NewGuid(), module = "Breakage", recordId = broken.GetProperty("id").GetGuid() }, Cancel);
        Assert.Equal(HttpStatusCode.Accepted, asked.StatusCode);
        Assert.False((await Json(await manager.GetAsync("/api/costing/breakage?days=7", Cancel))).EnumerateArray().Single().GetProperty("isVoided").GetBoolean());
        await Json(await manager.PostAsJsonAsync("/api/inventory/deletion-requests",
            new { requestId = Guid.NewGuid(), module = "Breakage", recordId = broken.GetProperty("id").GetGuid() }, Cancel));
        Assert.True((await Json(await manager.GetAsync("/api/costing/breakage?days=7", Cancel))).EnumerateArray().Single().GetProperty("isVoided").GetBoolean());
    }

    [Fact]
    public async Task The_cost_reports_answer_from_the_sales_purchases_and_settings()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var (_, large, _) = await PizzaAsync(manager);
        var today = await TodayAsync(manager);
        await Json(await manager.PostAsJsonAsync("/api/sales", new
        {
            id = Guid.NewGuid(), date = Iso(today), channel = "DineIn", paymentMethod = "Cash", lines = new[] { new { menuItemId = 6101, variantId = large, quantity = 4 } },
        }, Cancel));
        // The tax rate is the financials' own, set beside the service charge.
        var settings = await Json(await manager.PutAsJsonAsync("/api/financials/settings", new { servicePercent = 12, taxPercent = 14 }, Cancel));
        Assert.Equal((12m, 14m), (settings.GetProperty("servicePercent").GetDecimal(), settings.GetProperty("taxPercent").GetDecimal()));

        foreach (var path in new[]
                 {
                     $"/api/costing/theoretical?year={today.Year}&month={today.Month}", $"/api/costing/kpis?year={today.Year}&month={today.Month}",
                     $"/api/costing/break-even?fromYear={today.Year}&fromMonth={today.Month}&toYear={today.Year}&toMonth={today.Month}", "/api/costing/menu", "/api/costing/materials", "/api/costing/settings",
                     $"/api/financials/reconciliation?from={Iso(today)}&to={Iso(today)}", $"/api/financials/daily-cash?from={Iso(today)}&to={Iso(today)}",
                     $"/api/costing/purchases/spending?from={Iso(today.AddDays(-30))}&to={Iso(today)}",
                 })
            Assert.True((await manager.GetAsync(path, Cancel)).IsSuccessStatusCode, path);

        var kpis = await Json(await manager.GetAsync($"/api/costing/kpis?year={today.Year}&month={today.Month}", Cancel));
        Assert.Equal(720m, kpis.GetProperty("statement").GetProperty("foodSales").GetDecimal());
        var card = await Json(await manager.GetAsync($"/api/costing/recipe-card?targetKind=MenuItem&catalogItemId=6101&variantId={large}", Cancel));
        Assert.Equal((45m, 180m), (card.GetProperty("costPerPortion").GetDecimal(), card.GetProperty("menuPrice").GetDecimal()));
    }

    // Raw materials and expense items kept on one installation (a laptop's), written out, and the
    // files imported into another (the one online): the same list there, and imported again,
    // nothing left to change.
    [Fact]
    public async Task The_raw_materials_and_expense_items_go_to_another_installation_by_their_export()
    {
        await using var local = await TestApi.StartAsync();
        var here = await local.ManagerAsync();
        var mozzarella = (await Json(await here.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Mozzarella", unit = "Gram", code = "DAI-1", purchaseUnit = "kg", purchaseUnitSize = 1000, costPerPurchaseUnit = 300,
            reorderLevel = 2000, defaultYieldPercent = 95,
        }, Cancel))).GetProperty("id").GetGuid();
        // A delivery at another price moves the average: 2 kg at 300 and 3 kg at 340.
        await Json(await here.PostAsJsonAsync("/api/inventory/purchases", new
        {
            purchaseId = Guid.NewGuid(), lines = new[] { new { rawMaterialId = mozzarella, quantity = 2000, cost = 600 } },
        }, Cancel));
        await Json(await here.PostAsJsonAsync("/api/inventory/purchases", new
        {
            purchaseId = Guid.NewGuid(), lines = new[] { new { rawMaterialId = mozzarella, quantity = 3000, cost = 1020 } },
        }, Cancel));
        await Json(await here.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Eggs", unit = "Piece", purchaseUnit = "tray", purchaseUnitSize = 30, costPerPurchaseUnit = 127.5,
        }, Cancel));
        await Json(await here.PutAsJsonAsync($"/api/inventory/expense-items/{Guid.NewGuid()}", new { name = "Electricity", nameAr = "الكهرباء", unit = "month" }, Cancel));

        var materialsFile = await here.GetAsync("/api/inventory/raw-materials/export", Cancel);
        Assert.Equal(
            ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "raw-materials.xlsx"),
            (materialsFile.Content.Headers.ContentType!.MediaType, materialsFile.Content.Headers.ContentDisposition!.FileNameStar ?? materialsFile.Content.Headers.ContentDisposition.FileName));
        var materials = await materialsFile.Content.ReadAsByteArrayAsync(Cancel);
        var expenses = await (await here.GetAsync("/api/inventory/expense-items/export", Cancel)).Content.ReadAsByteArrayAsync(Cancel);

        await using var online = await TestApi.StartAsync();
        var there = await online.ManagerAsync();
        var imported = await Json(await there.PostAsync("/api/inventory/raw-materials/import", File(materials, "raw-materials.xlsx"), Cancel));
        Assert.Equal((2, 0), (imported.GetProperty("created").GetArrayLength(), imported.GetProperty("skipped").GetArrayLength()));
        Assert.Equal(1, (await Json(await there.PostAsync("/api/inventory/expense-items/import", File(expenses, "expense-items.xlsx"), Cancel))).GetProperty("created").GetArrayLength());

        // The same materials there, each as it is here but its stock, which comes by purchases and counts.
        static async Task<List<string>> Listed(HttpClient client) =>
            (await Json(await client.GetAsync("/api/costing/materials", Cancel))).EnumerateArray()
                .Select(m => string.Join(" | ", m.GetProperty("code").GetString(), m.GetProperty("name").GetString(), m.GetProperty("category").GetString(),
                    m.GetProperty("unit").GetString(), m.GetProperty("purchaseUnit").GetString(), m.GetProperty("purchaseUnitSize").GetDecimal().ToString("0.###", CultureInfo.InvariantCulture),
                    m.GetProperty("costPerPurchaseUnit").GetDecimal().ToString("0.####", CultureInfo.InvariantCulture),
                    m.GetProperty("reorderLevel").GetDecimal().ToString("0.###", CultureInfo.InvariantCulture), m.GetProperty("defaultYieldPercent").GetDecimal().ToString("0.##", CultureInfo.InvariantCulture)))
                .Order()
                .ToList();
        Assert.Equal(await Listed(here), await Listed(there));
        Assert.Contains(" | Eggs | General | Piece | tray | 30 | 127.5 | 0 | 100", await Listed(there));
        Assert.Contains("DAI-1 | Mozzarella | General | Gram | kg | 1000 | 324 | 2000 | 95", await Listed(there));
        Assert.Equal(0m, await OnHandAsync(there, (await Json(await there.GetAsync("/api/inventory/raw-materials", Cancel))).EnumerateArray().Single(m => m.GetProperty("name").GetString() == "Mozzarella").GetProperty("id").GetGuid()));
        var electricity = (await Json(await there.GetAsync("/api/inventory/expense-items", Cancel))).EnumerateArray().Single();
        Assert.Equal(("Electricity", "الكهرباء", "month", "General expenses"),
            (electricity.GetProperty("name").GetString(), electricity.GetProperty("nameAr").GetString(), electricity.GetProperty("unit").GetString(), electricity.GetProperty("category").GetString()));

        // Imported again: everything there already, nothing changed.
        var again = await Json(await there.PostAsync("/api/inventory/raw-materials/import", File(materials, "raw-materials.xlsx"), Cancel));
        Assert.Equal((0, 0, 2), (again.GetProperty("created").GetArrayLength(), again.GetProperty("updated").GetArrayLength(), again.GetProperty("unchanged").GetInt32()));

        // A storekeeper works Raw materials, not Expense items.
        var storekeeper = await online.UserAsync(there, "Samir", UserRole.Storekeeper);
        Assert.Equal(HttpStatusCode.OK, (await storekeeper.GetAsync("/api/inventory/raw-materials/export", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.GetAsync("/api/inventory/expense-items/export", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await storekeeper.PostAsync("/api/inventory/expense-items/import", File(expenses, "expense-items.xlsx"), Cancel)).StatusCode);

        // Not a workbook: refused as a whole, in both languages.
        var refused = await there.PostAsync("/api/inventory/raw-materials/import", File("not a sheet"u8.ToArray(), "notes.xlsx"), Cancel);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        Assert.Contains("تعذّرت قراءة الملف", await refused.Content.ReadAsStringAsync(Cancel));
    }

    // Recipes and prep items through the API: the smart template and the export, a dropdown of
    // ingredients with their units on a hidden sheet; an export imported back changes nothing,
    // one edited replaces the recipes it names and costs them; a prep item imported by anyone but
    // a manager waits for one.
    [Fact]
    public async Task Recipes_and_prep_items_come_and_go_by_their_smart_sheets()
    {
        await using var api = await TestApi.StartAsync();
        var manager = await api.ManagerAsync();
        var (mozzarella, large, _) = await PizzaAsync(manager);
        var flour = (await Json(await manager.PostAsJsonAsync("/api/inventory/raw-materials", new
        {
            name = "Flour", unit = "Gram", purchaseUnit = "kg", purchaseUnitSize = 1000, costPerPurchaseUnit = 30,
        }, Cancel))).GetProperty("id").GetGuid();
        await Json(await manager.PostAsJsonAsync("/api/inventory/prep-items", new
        {
            name = "Pizza dough", unit = "Gram", batchQuantity = 1000, ingredients = new[] { new { rawMaterialId = flour, quantity = 600 } },
        }, Cancel));

        // The template: no rows, every ingredient with its unit on the hidden sheet.
        using (var template = new XLWorkbook(await (await manager.GetAsync("/api/inventory/recipes/sheet/template", Cancel)).Content.ReadAsStreamAsync(Cancel)))
        {
            Assert.Empty(template.Worksheet("Recipes").RowsUsed().Skip(1));
            var ingredients = template.Worksheet("Ingredients");
            Assert.Equal(XLWorksheetVisibility.Hidden, ingredients.Visibility);
            Assert.Equal(["Flour (Kg)", "Mozzarella (Kg)", "Pizza dough · مصنّع (Kg)"], ingredients.Column(1).CellsUsed().Skip(1).Select(c => c.GetString()));
        }

        var exported = await manager.GetAsync("/api/inventory/recipes/sheet/export", Cancel);
        Assert.Equal("recipes.xlsx", exported.Content.Headers.ContentDisposition!.FileNameStar ?? exported.Content.Headers.ContentDisposition.FileName);
        var recipes = await exported.Content.ReadAsByteArrayAsync(Cancel);
        var again = await Json(await manager.PostAsync("/api/inventory/recipes/sheet/import", File(recipes, "recipes.xlsx"), Cancel));
        Assert.Equal((0, 0, 2), (again.GetProperty("created").GetArrayLength(), again.GetProperty("updated").GetArrayLength(), again.GetProperty("unchanged").GetInt32()));

        // Edited: the margherita's mozzarella 200 g, and a recipe for the large size.
        using (var book = new XLWorkbook(new MemoryStream(recipes)))
        {
            var sheet = book.Worksheet("Recipes");
            var margherita = sheet.RowsUsed().Single(r => r.Cell(1).GetString() == "6101 · Margherita");
            Assert.Equal(("Mozzarella (Kg)", 0.15), (margherita.Cell(2).GetString(), margherita.Cell(3).GetDouble()));
            margherita.Cell(3).Value = 0.2;
            var next = sheet.LastRowUsed()!.RowNumber() + 1;
            sheet.Cell(next, 1).Value = $"6101-{large} · Margherita (Large)";
            sheet.Cell(next, 2).Value = "Mozzarella (Kg)";
            sheet.Cell(next, 3).Value = 0.25;
            sheet.Cell(next + 1, 2).Value = "Pizza dough · مصنّع (Kg)";
            sheet.Cell(next + 1, 3).Value = 0.3;
            var imported = await Json(await manager.PostAsync("/api/inventory/recipes/sheet/import", Sheet(book, "recipes.xlsx"), Cancel));
            Assert.Equal((1, 1), (imported.GetProperty("created").GetArrayLength(), imported.GetProperty("updated").GetArrayLength()));
            var costs = imported.GetProperty("costed").EnumerateArray().ToDictionary(c => c.GetProperty("name").GetString()!);
            // 200 g of mozzarella at 300 a kg; the large size 75 of it and dough not priced yet.
            Assert.Equal((60m, "portion"), (costs["6101 · Margherita"].GetProperty("costPer").GetDecimal(), costs["6101 · Margherita"].GetProperty("per").GetString()));
            Assert.Equal(["Pizza dough"], costs[$"6101-{large} · Margherita (Large)"].GetProperty("missingPrices").EnumerateArray().Select(m => m.GetString()));
        }
        var card = await Json(await manager.GetAsync("/api/costing/recipe-card?targetKind=MenuItem&catalogItemId=6101", Cancel));
        Assert.Equal(200m, card.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("rawMaterialId").GetGuid() == mozzarella).GetProperty("quantity").GetDecimal());

        // The prep items' sheet, imported by a cost controller: asked of a manager, nothing changed yet.
        var controller = await api.UserAsync(manager, "Karim", UserRole.CostController);
        using (var prep = new XLWorkbook(await (await controller.GetAsync("/api/inventory/prep-items/sheet/export", Cancel)).Content.ReadAsStreamAsync(Cancel)))
        {
            var sheet = prep.Worksheet("Prep Items");
            Assert.Equal(["Pizza dough", "Flour (Kg)", "0.6", "1", "Kg"], sheet.Row(2).Cells(1, 5).Select(c => c.GetFormattedString()));
            sheet.Cell(2, 3).Value = 0.65;
            var asked = await Json(await controller.PostAsync("/api/inventory/prep-items/sheet/import", Sheet(prep, "prep-items.xlsx"), Cancel));
            Assert.Equal((0, 1), (asked.GetProperty("updated").GetArrayLength(), asked.GetProperty("requested").GetInt32()));
        }
        Assert.Contains((await Json(await manager.GetAsync("/api/inventory/approval-requests", Cancel))).GetProperty("pending").EnumerateArray(),
            r => r.GetProperty("module").GetString() == "PrepItem");

        // Recipes are not an accountant's section.
        var accountant = await api.AccountantAsync(manager);
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.GetAsync("/api/inventory/recipes/sheet/export", Cancel)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await accountant.PostAsync("/api/inventory/recipes/sheet/import", File(recipes, "recipes.xlsx"), Cancel)).StatusCode);
    }

    private static MultipartFormDataContent File(byte[] content, string name)
    {
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        return new MultipartFormDataContent { { file, "file", name } };
    }
}
