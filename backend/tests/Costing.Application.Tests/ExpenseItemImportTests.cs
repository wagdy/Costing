using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.Expenses;
using Costing.Domain.Categories;
using Costing.Domain.Expenses;

namespace Costing.Application.Tests;

// Expense items to and from a spreadsheet: a new name added, one on the list changed as its row
// says, a bad row said why in English and Arabic; the list written out imports back as it is.
public class ExpenseItemImportTests
{
    private readonly TestCosting _pos = new();

    private Task<ExpenseItemImportResult> Import(params ExpenseItemSheetRow[] rows) => _pos.Send(new ImportExpenseItemsCommand(rows));

    private async Task<ExpenseItem> Item(string name) => (await _pos.Inventory.ExpenseItems.GetAllAsync()).Single(i => i.Name == name);

    [Fact]
    public async Task A_new_name_is_added_one_on_the_list_changed_and_a_bad_row_says_why()
    {
        var utilities = Guid.NewGuid();
        await _pos.Send(new SavePurchaseCategoryCommand(utilities, "Utilities", "مرافق", ExpenseLine.Controllable, CategoryKind.Expenses));
        await _pos.Send(new SavePurchaseCategoryCommand(Guid.NewGuid(), "Dairy", null));
        await _pos.Send(new SaveExpenseItemCommand(Guid.NewGuid(), "Electricity", utilities, null, "month"));
        var old = Guid.NewGuid();
        await _pos.Send(new SaveExpenseItemCommand(old, "Pest control"));
        (await _pos.Inventory.ExpenseItems.GetByIdAsync(old))!.Archive();

        var result = await Import(
            new(2, " electricity ", "الكهرباء", "مرافق", null),
            new(3, "Cleaning spray", "منظف", "Cleaning", "bottle"),
            new(4, "Gas", null, null, null),
            new(5, "CLEANING SPRAY", null, null, null),
            new(6, null, "بدون اسم", null, null),
            new(7, "Pest control", null, null, null),
            new(8, "Milk crates", null, "dairy", null),
            new(9, "Water", null, "Utilities", new string('x', 33)));

        Assert.Equal([(3, "Cleaning spray", "Cleaning"), (4, "Gas", PurchaseCategory.GeneralExpensesName)], result.Created.Select(c => (c.Row, c.Name, c.Category)));
        // Found by its name, whatever its capitals: its Arabic name added; the rest as it was.
        Assert.Equal([(2, "Electricity", "NameAr")], result.Updated.Select(u => (u.Row, u.Name, string.Join(", ", u.Changes))));
        var electricity = await Item("Electricity");
        Assert.Equal(("الكهرباء", "month", utilities), (electricity.NameAr, electricity.Unit, electricity.CategoryId));
        Assert.Equal(("منظف", "bottle"), ((await Item("Cleaning spray")).NameAr, (await Item("Cleaning spray")).Unit));
        Assert.Equal(["Cleaning"], result.CategoriesAdded);
        Assert.Equal(
            CategoryKind.Expenses,
            (await _pos.Inventory.PurchaseCategories.GetAllAsync()).Single(c => c.Name == "Cleaning").Kind);
        Assert.Equal(
            [
                (5, "Also on row 3, which is the one imported."),
                (6, "No expense name."),
                (7, "Pest control is archived: restore it on Expense items rather than import it again."),
                (8, "Dairy is a raw materials category: give it a general expenses category."),
                (9, "The unit is longer than 32 characters."),
            ],
            result.Skipped.Select(s => (s.Row, s.Reason)));
        Assert.All(result.Skipped, s => Assert.False(string.IsNullOrWhiteSpace(s.ReasonAr)));
    }

    [Fact]
    public async Task The_list_written_out_imports_into_another_installation_as_it_is()
    {
        var repairs = Guid.NewGuid();
        await _pos.Send(new SavePurchaseCategoryCommand(repairs, "Repairs", null, ExpenseLine.Controllable, CategoryKind.Expenses));
        await _pos.Send(new SaveExpenseItemCommand(Guid.NewGuid(), "AC maintenance", repairs, "صيانة التكييف", "visit"));
        await _pos.Send(new SaveExpenseItemCommand(Guid.NewGuid(), "Bank fees"));
        var gone = Guid.NewGuid();
        await _pos.Send(new SaveExpenseItemCommand(gone, "Old item"));
        (await _pos.Inventory.ExpenseItems.GetByIdAsync(gone))!.Archive();

        var written = await _pos.Send(new GetExpenseItemSheetQuery());
        Assert.Equal(
            [new ExpenseItemSheetLine("Bank fees", null, PurchaseCategory.GeneralExpensesName, null), new ExpenseItemSheetLine("AC maintenance", "صيانة التكييف", "Repairs", "visit")],
            written.Lines);
        Assert.Contains("Repairs", written.Categories);

        var rows = written.Lines.Select((l, i) => new ExpenseItemSheetRow(i + 2, l.Name, l.NameAr, l.Category, l.Unit)).ToArray();
        var elsewhere = new TestCosting();
        var imported = await elsewhere.Send(new ImportExpenseItemsCommand(rows));
        Assert.Equal((2, 0), (imported.Created.Count, imported.Skipped.Count));
        Assert.Equal(written.Lines, (await elsewhere.Send(new GetExpenseItemSheetQuery())).Lines);

        var again = await Import(rows);
        Assert.Equal((0, 0, 2), (again.Created.Count, again.Updated.Count, again.Unchanged));
    }

    [Fact]
    public async Task An_empty_sheet_is_refused()
    {
        var empty = await Assert.ThrowsAsync<DomainException>(() => Import());
        Assert.StartsWith("The sheet has no expense items on it", empty.Message);
    }
}
