using MediatR;
using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Categories;
using Costing.Domain.Expenses;

namespace Costing.Application.Expenses;

// Expense items to and from a spreadsheet, as the raw materials are (RawMaterialSheet): the list
// written out, and a sheet read back in, the template's, an export edited, or one exported from
// another installation. A row is the expense item of its name (capitals and spacing aside),
// changed as the row says; a row naming none is a new one. A blank cell leaves that detail as it
// is. A bad row is skipped and said why, in English and Arabic; a category not on the list yet is
// added as a general expenses one.

public sealed record ExpenseItemSheetRow(int Row, string? Name, string? NameAr, string? Category, string? Unit);

public sealed record ExpenseItemSheetLine(string Name, string? NameAr, string Category, string? Unit);

// What the sheet is written from: the expense items, and the general expenses categories for its
// dropdown.
public sealed record ExpenseItemSheet(IReadOnlyList<ExpenseItemSheetLine> Lines, IReadOnlyList<string> Categories);

public sealed record ImportedExpenseItem(int Row, Guid Id, string Name, string Category);

public sealed record ExpenseItemImportResult(
    IReadOnlyList<ImportedExpenseItem> Created,
    IReadOnlyList<UpdatedSheetItem> Updated,
    int Unchanged,
    IReadOnlyList<SkippedSheetRow> Skipped,
    IReadOnlyList<string> CategoriesAdded);

public sealed record ImportExpenseItemsCommand(IReadOnlyList<ExpenseItemSheetRow> Rows) : IRequest<ExpenseItemImportResult>;

public sealed record GetExpenseItemSheetQuery : IRequest<ExpenseItemSheet>;

internal sealed class GetExpenseItemSheetHandler(IExpenseItemRepository items, IPurchaseCategoryRepository categories)
    : IRequestHandler<GetExpenseItemSheetQuery, ExpenseItemSheet>
{
    public async Task<ExpenseItemSheet> Handle(GetExpenseItemSheetQuery request, CancellationToken cancellationToken)
    {
        var all = await categories.GetAllAsync(cancellationToken);
        var byId = all.ToDictionary(c => c.Id);
        var lines = (await items.GetAllAsync(cancellationToken))
            .Where(i => !i.IsArchived)
            .Select(i => new ExpenseItemSheetLine(i.Name, i.NameAr, byId.GetValueOrDefault(i.CategoryId)?.Name ?? PurchaseCategory.GeneralExpensesName, i.Unit))
            .OrderBy(l => l.Category, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(l => l.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        var names = all.Where(c => c.Kind == CategoryKind.Expenses).Select(c => c.Name).OrderBy(n => n, StringComparer.CurrentCultureIgnoreCase).ToList();
        return new ExpenseItemSheet(lines, names);
    }
}

internal sealed class ImportExpenseItemsHandler(IExpenseItemRepository items, IPurchaseCategoryRepository categories, IUnitOfWork unitOfWork)
    : IRequestHandler<ImportExpenseItemsCommand, ExpenseItemImportResult>
{
    public const int MaxRows = 2000;
    private const int MaxNameLength = 200;
    private const int MaxUnitLength = 32;
    private const int MaxCategoryLength = 100;

    public async Task<ExpenseItemImportResult> Handle(ImportExpenseItemsCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no expense items on it: fill in a row under the headings. · لا توجد مصروفات في الملف: املأ صفًا تحت العناوين.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import at most {MaxRows:N0} expense items at a time: split the sheet. · استورد {MaxRows:N0} بندًا على الأكثر في المرة: قسّم الملف.");

        var byName = new Dictionary<string, ExpenseItem>();
        foreach (var item in await items.GetAllAsync(cancellationToken))
            byName.TryAdd(item.NormalizedName, item);
        var known = new Dictionary<string, PurchaseCategory>();
        foreach (var category in await categories.GetAllAsync(cancellationToken))
        {
            known.TryAdd(PurchaseCategory.Normalize(category.Name), category);
            if (category.NameAr is { } ar)
                known.TryAdd(PurchaseCategory.Normalize(ar), category);
        }

        var created = new List<ImportedExpenseItem>();
        var updated = new List<UpdatedSheetItem>();
        var unchanged = 0;
        var skipped = new List<SkippedSheetRow>();
        var added = new List<string>();
        var onSheet = new Dictionary<string, int>();
        foreach (var row in request.Rows.OrderBy(r => r.Row))
        {
            var name = SheetText.Clean(row.Name);
            var nameAr = SheetText.Clean(row.NameAr);
            var unit = SheetText.Clean(row.Unit);
            var categoryName = SheetText.Clean(row.Category);
            void Skip(string reason, string reasonAr) => skipped.Add(new SkippedSheetRow(row.Row, name, reason, reasonAr));

            if (name is null)
            {
                Skip("No expense name.", "لا يوجد اسم للمصروف.");
                continue;
            }
            if (name.Length > MaxNameLength || nameAr?.Length > MaxNameLength)
            {
                Skip($"The name is longer than {MaxNameLength} characters.", $"الاسم أطول من {MaxNameLength} حرف.");
                continue;
            }
            if (unit?.Length > MaxUnitLength)
            {
                Skip($"The unit is longer than {MaxUnitLength} characters.", $"الوحدة أطول من {MaxUnitLength} حرفًا.");
                continue;
            }
            var key = ExpenseItem.Normalize(name);
            if (onSheet.TryGetValue(key, out var first))
            {
                Skip($"Also on row {first}, which is the one imported.", $"مكرر في الصف {first}، وهو الذي استُورد.");
                continue;
            }
            var existing = byName.GetValueOrDefault(key);
            if (existing is { IsArchived: true })
            {
                Skip(
                    $"{existing.Name} is archived: restore it on Expense items rather than import it again.",
                    $"{existing.Name} مؤرشف: استرجعه من صفحة المصروفات العمومية بدلًا من استيراده.");
                continue;
            }
            if (categoryName?.Length > MaxCategoryLength)
            {
                Skip($"The category's name is longer than {MaxCategoryLength} characters.", $"اسم القسم أطول من {MaxCategoryLength} حرف.");
                continue;
            }
            if (categoryName is not null && known.TryGetValue(PurchaseCategory.Normalize(categoryName), out var filedUnder) && filedUnder.Kind != CategoryKind.Expenses)
            {
                Skip(
                    $"{filedUnder.Name} is a raw materials category: give it a general expenses category.",
                    $"{filedUnder.Name} قسم خامات: اختر قسمًا من أقسام المصروفات العمومية.");
                continue;
            }

            var category = categoryName is null ? null : await CategoryAsync(categoryName, known, added, cancellationToken);
            onSheet[key] = row.Row;
            if (existing is null)
            {
                category ??= await categories.ResolveAsync(null, CategoryKind.Expenses, null, cancellationToken);
                var item = new ExpenseItem(Guid.NewGuid(), name, category.Id, nameAr, unit);
                items.Add(item);
                byName[key] = item;
                created.Add(new ImportedExpenseItem(row.Row, item.Id, item.Name, category.Name));
                continue;
            }

            // Found by its name: kept as it is written, whatever the row's capitals.
            var changes = new List<string>();
            if (nameAr is not null && nameAr != existing.NameAr)
                changes.Add("NameAr");
            if (unit is not null && unit != existing.Unit)
                changes.Add("Unit");
            if (category is not null && category.Id != existing.CategoryId)
                changes.Add("Category");
            if (changes.Count == 0)
            {
                unchanged++;
                continue;
            }
            existing.Update(existing.Name, category?.Id ?? existing.CategoryId, nameAr ?? existing.NameAr, unit ?? existing.Unit);
            updated.Add(new UpdatedSheetItem(row.Row, existing.Id, existing.Name, changes));
        }

        if (created.Count > 0 || updated.Count > 0)
            await unitOfWork.SaveChangesAsync(cancellationToken);
        return new ExpenseItemImportResult(created, updated, unchanged, skipped, added);
    }

    // The category of that name, English or Arabic; a general expenses one added when there is
    // none. General expenses is the default one, whatever it is called here, never a second.
    private async Task<PurchaseCategory> CategoryAsync(
        string name, Dictionary<string, PurchaseCategory> known, List<string> added, CancellationToken cancellationToken)
    {
        if (known.TryGetValue(PurchaseCategory.Normalize(name), out var found))
            return found;
        if (PurchaseCategory.Normalize(name) == PurchaseCategory.Normalize(PurchaseCategory.GeneralExpensesName) || name == PurchaseCategory.GeneralExpensesNameAr)
            return known[PurchaseCategory.Normalize(name)] = await categories.ResolveAsync(null, CategoryKind.Expenses, null, cancellationToken);
        var category = new PurchaseCategory(Guid.NewGuid(), name, kind: CategoryKind.Expenses);
        categories.Add(category);
        known[PurchaseCategory.Normalize(name)] = category;
        added.Add(category.Name);
        return category;
    }
}
