# الفصل 05: المشتريات، تقفيل اليوم، والمخزون

[← الفصل السابق](04-catalog-materials-recipes-and-menu.md) · [الفهرس](00-index-and-build-roadmap.md) · [الفصل التالي: الماليات والخزنة والتحليلات →](06-financials-safe-tax-and-intelligence.md)

## 1. فاتورة الشراء: خطوتان لا خطوة

```text
مسودة (Draft) ──"تأكيد وترحيل"──► مرحّلة (Posted) ──إلغاء/تعديل──► ملغاة (Voided) + فاتورة جديدة تسمّيها
  تُكتب وتُراجع وتُصوَّر          يدخل المخزون ويتحرك المتوسط       حركات عكسية بنفس التكلفة
  لا يتحرك شيء                    ويُسجَّل الدفع أو الدين
```

لماذا خطوتان؟ لأن المخزون والمتوسط لا يُعدَّلان بعد الحركة؛ المراجعة قبل الترحيل أرخص بكثير من الإلغاء بعده.

### 1.1 بنود الفاتورة

لكل بند: خامة (تدخل المخزون بوحدة الشراء ⇐ تتحول للوحدة الأساسية) أو مصروف (تكلفة تحت فئته في قائمة الدخل). و:

- `LineTotal`: إجمالي البند **كما كُتب على الورقة**.
- `Discount`: خصم البند نفسه.
- `DiscountShare`: حصته من خصم الفاتورة الكلي.
- `Cost` = `LineTotal − Discount − DiscountShare`: **الصافي** الذي يدخل المتوسط ويُسجل في الخزنة/الدين.

### 1.2 توزيع خصم الفاتورة بالقرش (Largest Remainder)

**المشكلة:** خصم 10 جنيهات على فاتورة بنودها 100.00 و 50.00 و 33.33 (الصافي 183.33). التوزيع النسبي يعطي كسورًا لا تُدفع (5.4547…)، والتقريب العادي لكل بند قد يجعل المجموع 9.99 أو 10.01، أي **قرش ضائع أو زائد** في الدفاتر.

**الحل في `PurchaseInvoice.ShareDiscount`:**

```text
1. حوّل الخصم لقروش:           cents = 1000
2. الحصة الدقيقة لكل بند:       exact_i = cents × صافي البند ÷ مجموع الصافي
                                  = 545.47 ، 272.73 ، 181.80
3. خذ الجزء الصحيح (للأسفل):    545 ، 272 ، 181      ⇐ المجموع 998
4. المتبقي = 1000 − 998 = 2 قرش
5. أعطِ قرشًا لكل بند خسر أكثر في التقريب (أكبر كسر):
     الكسور: 0.47 ، 0.73 ، 0.80  ⇐ البند 3 ثم البند 2
6. النتيجة: 5.45 ، 2.73 ، 1.82   ⇐ المجموع 10.00 بالضبط
```

وقواعد الحماية: لا خصم سالب، لا خصم بلا بنود مسعّرة، ولا خصم أكبر من مجموع البنود. والتعادل في الكسور يُحسم بترتيب البنود (`ThenBy(i => i)`) فالنتيجة حتمية.

**لماذا مهم محاسبيًا؟** لأن كل خامة يجب أن تدخل المخزون بتكلفتها **الحقيقية بعد الخصم**؛ خصم الفاتورة يخفّض متوسط كل خامة فيها بقدر نصيبها، لا خامة واحدة.

### 1.3 الكود

`PurchaseInvoices.cs`: `InvoiceRecorder` (حفظ المسودة: التحقق من البنود، الوحدات، المورد، الخصم)، و `InvoicePoster` (الترحيل: يُدخل المخزون بحركات `Purchase` ويحرك المتوسط، ويسجل الدفع: نقدي من الخزنة، أو من إيراد يوم، أو آجل على المورد)، والقراءة. المعرّف يصنعه "الـ till" (المتصفح).

> 📄 **`backend/src/Costing.Application/Purchases/PurchaseInvoices.cs`** — 523 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Expenses;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;
using Costing.Application.Books;
using Costing.Application.Company;

namespace Costing.Application.Purchases;

// Supplier invoices, entered in two steps: saved as a draft while the lines are typed and checked
// (and the paper photographed), then posted, which takes the stock in. InvoiceId is made by the
// till. Staff names are set by the API from who is signed in.

public sealed record PurchaseAttachmentDto(string FileName, string ContentType, int Bytes, DateTime AttachedAtUtc, string? AttachedBy);

// Material: the line's name, the material's or the expense's. Unit is the material's own; an
// expense line has none. Category: what the item is filed under now.
public sealed record PurchaseInvoiceLineDto(
    Guid? RawMaterialId,
    string Material,
    UnitOfMeasure? Unit,
    decimal EnteredQuantity,
    string UnitLabel,
    decimal UnitSize,
    decimal Quantity,
    decimal? Cost,
    PurchaseItemType ItemType,
    Guid? ExpenseItemId,
    Guid? CategoryId,
    string? Category,
    string? CategoryAr,
    // Cost is after every discount: the line as written (LineTotal), less its own (Discount) and
    // its share of the invoice's (DiscountShare).
    decimal? LineTotal = null,
    decimal Discount = 0,
    decimal DiscountShare = 0);

public sealed record PurchaseInvoiceDto(
    Guid Id,
    PurchaseInvoiceStatus Status,
    Guid? SupplierId,
    string? SupplierName,
    string? SupplierInvoiceNumber,
    DateOnly? InvoiceDate,
    DateTime CreatedAtUtc,
    string CreatedBy,
    DateTime? PostedAtUtc,
    string? PostedBy,
    decimal Total,
    PurchaseAttachmentDto? Attachment,
    IReadOnlyList<PurchaseInvoiceLineDto> Lines,
    // What went into stock, and what was expenses: Total split.
    decimal InventoryTotal,
    decimal ExpenseTotal,
    DateTime? VoidedAtUtc = null,
    string? VoidedBy = null,
    PurchasePaymentMethod? PaymentMethod = null,
    DateOnly? RevenueDate = null,
    InvoicePaymentStatus PaymentStatus = InvoicePaymentStatus.NotPosted,
    // A correction: the invoice it corrects; and on that one, the invoice that corrected it.
    Guid? RevisionOf = null,
    Guid? ReplacedBy = null,
    // Total is what is paid: the lines as written (Subtotal), less their own discounts
    // (LineDiscounts) and the invoice's (Discount).
    decimal Subtotal = 0,
    decimal LineDiscounts = 0,
    decimal Discount = 0,
    // The purchase order it delivers: a draft's set against it item by item (the 3-way match), a
    // posted one's named. AwaitingApproval: its posting waits for a manager to sign off what is over the order.
    PurchaseOrderMatchDto? PurchaseOrder = null,
    bool AwaitingApproval = false);

// What an invoice's lines are named and filed under, read together for a DTO; with Receiver, the
// purchase order it delivers too.
internal sealed record InvoiceReading(
    IRawMaterialRepository Materials,
    IExpenseItemRepository Expenses,
    IPurchaseCategoryRepository Categories,
    ISupplierRepository Suppliers,
    ISafeTransactionRepository Safe,
    IApprovalRequestRepository Requests,
    PurchaseOrderReceiver? Receiver = null)
{
    public async Task<PurchaseInvoiceDto> DtoAsync(PurchaseInvoice invoice, CancellationToken cancellationToken)
    {
        var materialIds = invoice.Lines.Where(l => l.RawMaterialId is not null).Select(l => l.RawMaterialId!.Value).Distinct().ToList();
        var materials = materialIds.Count == 0
            ? new Dictionary<Guid, RawMaterial>()
            : (await Materials.GetByIdsAsync(materialIds, cancellationToken)).ToDictionary(m => m.Id);
        var expenseIds = invoice.Lines.Where(l => l.ExpenseItemId is not null).Select(l => l.ExpenseItemId!.Value).Distinct().ToList();
        var expenses = expenseIds.Count == 0
            ? new Dictionary<Guid, ExpenseItem>()
            : (await Expenses.GetByIdsAsync(expenseIds, cancellationToken)).ToDictionary(e => e.Id);
        var categories = invoice.Lines.Count == 0
            ? new Dictionary<Guid, PurchaseCategory>()
            : (await Categories.GetAllAsync(cancellationToken)).ToDictionary(c => c.Id);
        var supplier = invoice.SupplierId is { } id ? await Suppliers.GetByIdAsync(id, cancellationToken) : null;
        var awaiting = invoice.Status == PurchaseInvoiceStatus.Draft
            && await Requests.GetPendingForAsync(invoice.Id, cancellationToken) is { Module: ApprovalModule.PurchaseInvoice, Action: ApprovalAction.Create };
        PurchaseOrderMatchDto? order = null;
        if (Receiver is not null && invoice.PurchaseOrderId is not null)
        {
            try
            {
                if (await Receiver.OrderOfAsync(invoice, cancellationToken) is { } po)
                    order = await Receiver.MatchDtoAsync(
                        po, invoice, invoice.Status == PurchaseInvoiceStatus.Draft ? await Receiver.MatchAsync(po, invoice, cancellationToken) : null,
                        cancellationToken);
            }
            catch (Exception error) when (error is DomainException or NotFoundException)
            {
                // Its supplier changed since: shown without the order, which posting refuses.
            }
        }
        return Dto(invoice, materials, expenses, categories, supplier) with
        {
            PaymentStatus = await InvoicePayments.StatusAsync(invoice, Safe, Requests, cancellationToken),
            PurchaseOrder = order,
            AwaitingApproval = awaiting,
        };
    }

    public static PurchaseInvoiceDto Dto(
        PurchaseInvoice invoice,
        IReadOnlyDictionary<Guid, RawMaterial> materials,
        IReadOnlyDictionary<Guid, ExpenseItem> expenses,
        IReadOnlyDictionary<Guid, PurchaseCategory> categories,
        Supplier? supplier) => new(
        invoice.Id, invoice.Status, invoice.SupplierId, supplier?.Name, invoice.SupplierInvoiceNumber, invoice.InvoiceDate,
        invoice.CreatedAtUtc, invoice.CreatedBy, invoice.PostedAtUtc, invoice.PostedBy, invoice.Total,
        invoice.HasAttachment
            ? new PurchaseAttachmentDto(invoice.AttachmentFileName!, invoice.AttachmentContentType!, invoice.AttachmentBytes ?? 0, invoice.AttachedAtUtc!.Value, invoice.AttachedBy)
            : null,
        invoice.Lines.Select(l => Line(l, materials, expenses, categories)).ToList(),
        invoice.InventoryTotal,
        invoice.ExpenseTotal,
        invoice.VoidedAtUtc,
        invoice.VoidedBy,
        invoice.PaymentMethod,
        invoice.RevenueDate,
        RevisionOf: invoice.RevisionOf,
        ReplacedBy: invoice.ReplacedBy,
        Subtotal: invoice.Subtotal,
        LineDiscounts: invoice.LineDiscounts,
        Discount: invoice.Discount);

    private static PurchaseInvoiceLineDto Line(
        PurchaseInvoiceLine l,
        IReadOnlyDictionary<Guid, RawMaterial> materials,
        IReadOnlyDictionary<Guid, ExpenseItem> expenses,
        IReadOnlyDictionary<Guid, PurchaseCategory> categories)
    {
        if (l.ItemType == PurchaseItemType.Expense)
        {
            var expense = expenses.GetValueOrDefault(l.ExpenseItemId!.Value);
            var category = expense is null ? null : categories.GetValueOrDefault(expense.CategoryId);
            return new PurchaseInvoiceLineDto(
                null, expense?.Name ?? "A removed expense", null, l.EnteredQuantity, l.UnitLabel, l.UnitSize, l.Quantity, l.Cost,
                l.ItemType, l.ExpenseItemId, category?.Id, category?.Name, category?.NameAr, l.LineTotal, l.Discount, l.DiscountShare);
        }

        var material = materials.GetValueOrDefault(l.RawMaterialId!.Value);
        var filed = material is null ? null : categories.GetValueOrDefault(material.CategoryId);
        return new PurchaseInvoiceLineDto(
            l.RawMaterialId, material?.Name ?? "A removed material", material?.Unit ?? UnitOfMeasure.Piece, l.EnteredQuantity, l.UnitLabel,
            l.UnitSize, l.Quantity, l.Cost, l.ItemType, null, filed?.Id, filed?.Name, filed?.NameAr, l.LineTotal, l.Discount, l.DiscountShare);
    }
}

public sealed record PurchaseInvoiceSummaryDto(
    Guid Id,
    PurchaseInvoiceStatus Status,
    Guid? SupplierId,
    string? SupplierName,
    string? SupplierInvoiceNumber,
    DateOnly? InvoiceDate,
    DateTime CreatedAtUtc,
    string CreatedBy,
    DateTime? PostedAtUtc,
    string? PostedBy,
    decimal Total,
    int Lines,
    // Null while no paper is attached.
    string? AttachmentFileName,
    decimal InventoryTotal,
    decimal ExpenseTotal,
    DateTime? VoidedAtUtc = null,
    string? VoidedBy = null,
    PurchasePaymentMethod? PaymentMethod = null,
    DateOnly? RevenueDate = null,
    InvoicePaymentStatus PaymentStatus = InvoicePaymentStatus.NotPosted,
    Guid? PurchaseOrderId = null);

// Posted invoices newest first, or the drafts.
public sealed record GetPurchaseInvoicesQuery(PurchaseInvoiceStatus Status) : IRequest<IReadOnlyList<PurchaseInvoiceSummaryDto>>;

internal sealed class GetPurchaseInvoicesQueryHandler(
    IPurchaseInvoiceRepository invoices, ISupplierRepository suppliers, ISafeTransactionRepository safe, IApprovalRequestRepository requests,
    ICurrentBranch branch)
    : IRequestHandler<GetPurchaseInvoicesQuery, IReadOnlyList<PurchaseInvoiceSummaryDto>>
{
    public async Task<IReadOnlyList<PurchaseInvoiceSummaryDto>> Handle(GetPurchaseInvoicesQuery request, CancellationToken cancellationToken)
    {
        // Archived ones too: an invoice keeps showing who it was from.
        var names = (await suppliers.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        // The branch's own, when the company has several.
        var listed = await branch.NarrowAsync(await invoices.GetByStatusAsync(request.Status, cancellationToken), cancellationToken);
        var paid = await safe.PaidInvoicesAsync(listed.Select(i => i.Id).ToList(), cancellationToken);
        var pending = (await requests.GetPendingAsync(cancellationToken)).Where(r => r.Module == ApprovalModule.Treasury).Select(r => r.RecordId).ToHashSet();
        return listed
            .OrderByDescending(i => i.PostedAtUtc ?? i.CreatedAtUtc)
            .Select(i => new PurchaseInvoiceSummaryDto(
                i.Id, i.Status, i.SupplierId, i.SupplierId is { } id ? names.GetValueOrDefault(id) : null,
                i.SupplierInvoiceNumber, i.InvoiceDate, i.CreatedAtUtc, i.CreatedBy,
                i.PostedAtUtc, i.PostedBy, i.Total, i.Lines.Count, i.AttachmentFileName, i.InventoryTotal, i.ExpenseTotal, i.VoidedAtUtc, i.VoidedBy,
                i.PaymentMethod, i.RevenueDate, InvoicePayments.StatusOf(i, paid.Contains(i.Id), pending.Contains(i.Id)), i.PurchaseOrderId))
            .ToList();
    }
}

public sealed record GetPurchaseInvoiceQuery(Guid InvoiceId) : IRequest<PurchaseInvoiceDto?>;

internal sealed class GetPurchaseInvoiceQueryHandler(
    IPurchaseInvoiceRepository invoices,
    IRawMaterialRepository materials,
    IExpenseItemRepository expenses,
    IPurchaseCategoryRepository categories,
    ISupplierRepository suppliers,
    ISafeTransactionRepository safe,
    IApprovalRequestRepository requests,
    PurchaseOrderReceiver receiver) : IRequestHandler<GetPurchaseInvoiceQuery, PurchaseInvoiceDto?>
{
    public async Task<PurchaseInvoiceDto?> Handle(GetPurchaseInvoiceQuery request, CancellationToken cancellationToken) =>
        await invoices.GetByIdAsync(request.InvoiceId, cancellationToken) is { } invoice
            ? await new InvoiceReading(materials, expenses, categories, suppliers, safe, requests, receiver).DtoAsync(invoice, cancellationToken)
            : null;
}

// Step one: the invoice as entered, kept as a draft. Created on its first save. Discount: the
// invoice's own (خصم الفاتورة), off what its lines come to after theirs.
public sealed record SavePurchaseInvoiceCommand(
    Guid InvoiceId,
    Guid? SupplierId,
    string? SupplierInvoiceNumber,
    DateOnly? InvoiceDate,
    IReadOnlyList<PurchaseInvoiceLineEntry> Lines,
    string StaffName = "",
    PurchasePaymentMethod? PaymentMethod = null,
    DateOnly? RevenueDate = null,
    decimal Discount = 0,
    // The purchase order it delivers, and whether it closes it with what came (no backorder).
    Guid? PurchaseOrderId = null,
    bool ClosesPurchaseOrder = false) : IRequest<PurchaseInvoiceDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [InvoiceDate, RevenueDate];
}

// The checks and the recording of an invoice as entered, for a draft saved on its own and for each
// invoice of a daily batch alike. Tracked, for the caller to save.
internal sealed class InvoiceRecorder(
    IPurchaseInvoiceRepository invoices, IRawMaterialRepository materials, IExpenseItemRepository expenses, ISupplierRepository suppliers)
{
    public async Task<PurchaseInvoice> RecordAsync(SavePurchaseInvoiceCommand request, CancellationToken cancellationToken)
    {
        var invoice = await invoices.GetByIdAsync(request.InvoiceId, cancellationToken);
        if (invoice is null)
            invoices.Add(invoice = new PurchaseInvoice(request.InvoiceId, request.StaffName));
        await FillAsync(invoice, request, invoice, cancellationToken);
        return invoice;
    }

    // A posted invoice's correction, as a new invoice: tracked to be posted (track), or only built
    // and checked, for a request that waits for a manager. What the original had (a material,
    // expense or supplier archived since) stays allowed on it.
    public async Task<PurchaseInvoice> CorrectionAsync(
        PurchaseInvoice original, SavePurchaseInvoiceCommand request, bool track, CancellationToken cancellationToken)
    {
        if (await invoices.GetByIdAsync(request.InvoiceId, cancellationToken) is not null)
            throw new DomainException("That correction has been entered already.");
        var invoice = new PurchaseInvoice(request.InvoiceId, request.StaffName);
        invoice.Corrects(original);
        await FillAsync(invoice, request, original, cancellationToken);
        if (track)
            invoices.Add(invoice);
        return invoice;
    }

    // keep: the invoice whose materials, expenses and supplier may stay although archived since.
    private async Task FillAsync(PurchaseInvoice invoice, SavePurchaseInvoiceCommand request, PurchaseInvoice keep, CancellationToken cancellationToken)
    {
        // A draft can be saved before its lines, to attach its paper first.
        var materialIds = request.Lines
            .Where(l => l.ItemType == PurchaseItemType.Inventory && l.RawMaterialId is not null)
            .Select(l => l.RawMaterialId!.Value)
            .ToList();
        var onInvoice = materialIds.Count == 0
            ? new Dictionary<Guid, RawMaterial>()
            : await materials.GetRequiredByIdsAsync(materialIds, cancellationToken);
        if (onInvoice.Values.FirstOrDefault(m => m.IsPrepItem) is { } made)
            throw new DomainException($"{made.Name} is made in the kitchen, not bought: make it with a production order.");

        // A material deleted since stays on a draft that already had it, but goes on no other.
        var drafted = keep.Lines.Select(l => l.RawMaterialId).ToHashSet();
        if (onInvoice.Values.FirstOrDefault(m => m.IsArchived && !drafted.Contains(m.Id)) is { } archivedMaterial)
            throw new DomainException($"{archivedMaterial.Name} has been deleted from the raw materials.");

        // An archived expense stays on a draft that already had it, but is not put on another.
        var expenseIds = request.Lines.Where(l => l.ItemType == PurchaseItemType.Expense && l.ExpenseItemId is not null)
            .Select(l => l.ExpenseItemId!.Value).Distinct().ToList();
        if (expenseIds.Count > 0)
        {
            var found = (await expenses.GetByIdsAsync(expenseIds, cancellationToken)).ToDictionary(e => e.Id);
            if (expenseIds.Any(id => !found.ContainsKey(id)))
                throw new DomainException("An expense on this invoice is no longer on the list. Choose it again, or add it.");
            var already = keep.Lines.Select(l => l.ExpenseItemId).ToHashSet();
            if (found.Values.FirstOrDefault(e => e.IsArchived && !already.Contains(e.Id)) is { } archived)
                throw new DomainException($"{archived.Name} is archived. Restore it on the Expense items tab to put it on an invoice again.");
        }

        // An archived supplier stays on a draft that already had it, but is not put on another.
        if (request.SupplierId is { } supplierId && supplierId != keep.SupplierId)
        {
            var supplier = await suppliers.GetByIdAsync(supplierId, cancellationToken)
                ?? throw new DomainException("That supplier is no longer on the list. Choose it again, or add it.");
            if (supplier.IsArchived)
                throw new DomainException($"{supplier.Name} is archived. Restore it on the Suppliers tab to invoice it again.");
        }

        invoice.Record(
            request.SupplierId, request.SupplierInvoiceNumber, request.InvoiceDate, request.Lines, request.PaymentMethod, request.RevenueDate,
            request.Discount);
        // A correction keeps the order of the invoice it corrects.
        if (invoice.RevisionOf is null)
            invoice.Delivers(request.PurchaseOrderId, request.ClosesPurchaseOrder);
    }
}

internal sealed class SavePurchaseInvoiceCommandHandler(
    InvoiceRecorder recorder,
    IRawMaterialRepository materials,
    IExpenseItemRepository expenses,
    IPurchaseCategoryRepository categories,
    ISupplierRepository suppliers,
    ISafeTransactionRepository safe,
    IApprovalRequestRepository requests,
    PurchaseOrderReceiver receiver,
    IUnitOfWork unitOfWork) : IRequestHandler<SavePurchaseInvoiceCommand, PurchaseInvoiceDto>
{
    public async Task<PurchaseInvoiceDto> Handle(SavePurchaseInvoiceCommand request, CancellationToken cancellationToken)
    {
        // Waiting for a manager to sign off what is over its order: kept as it was asked about.
        await requests.EnsureNotPendingAsync(request.InvoiceId, cancellationToken);
        var invoice = await recorder.RecordAsync(request, cancellationToken);
        if (await receiver.OrderOfAsync(invoice, cancellationToken) is { } order)
            PurchaseOrderReceiver.EnsureReceivable(order, invoice);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await new InvoiceReading(materials, expenses, categories, suppliers, safe, requests, receiver).DtoAsync(invoice, cancellationToken);
    }
}

// Step two: confirmed, the stock goes in and the average costs move; expense lines are recorded
// as they are, touching no stock. Its payment is settled as chosen: on credit, owed to the
// supplier; in cash, paid for a manager and asked of one for anyone else (the stock is in either
// way). Posting again, after an answer was lost, returns the posted invoice and changes nothing.
public sealed record PostPurchaseInvoiceCommand(Guid InvoiceId, string StaffName = "", string StaffId = "", bool CanApprove = true)
    : IRequest<PurchaseInvoiceDto>, IRetryOnConflict, IBooksEntry;

// Posting an invoice: its stock in and its payment settled, for an invoice posted on its own and for
// each invoice of a daily batch alike. Tracked, for the caller to save.
internal sealed class InvoicePoster(
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    IApprovalRequestRepository requests,
    TreasuryWriter treasury,
    PurchaseOrderReceiver receiver)
{
    // Posted: its stock in, its payment settled, and what it brought counted on its purchase order.
    public async Task PostAsync(PurchaseInvoice invoice, string staffName, string staffId, bool canApprove, CancellationToken cancellationToken)
    {
        var order = await receiver.OrderOfAsync(invoice, cancellationToken);
        if (order is not null)
            PurchaseOrderReceiver.EnsureReceivable(order, invoice);
        var materialIds = invoice.Lines.Where(l => l.RawMaterialId is not null).Select(l => l.RawMaterialId!.Value).ToList();
        IReadOnlyDictionary<Guid, RawMaterial> byId = materialIds.Count == 0
            ? new Dictionary<Guid, RawMaterial>()
            : await materials.GetRequiredByIdsAsync(materialIds, cancellationToken);
        foreach (var movement in invoice.Post(byId, staffName))
            movements.Add(movement);
        await treasury.SettleAsync(invoice, Guid.NewGuid(), staffId, staffName, canApprove, requests, cancellationToken);
        if (order is not null)
            await receiver.PostedAsync(invoice, order, staffName, cancellationToken);
    }

    // Posted now; or, for anyone who may not approve, an invoice against a purchase order billed
    // above its prices or bringing more than was left to come (ThreeWayMatch) is asked of a manager
    // instead: it stays a draft, its stock out and the average costs as they were, until a manager
    // signs the differences off. Returns the request when it was asked.
    public async Task<ApprovalRequest?> PostOrAskAsync(PurchaseInvoice invoice, string staffName, string staffId, bool canApprove, CancellationToken cancellationToken)
    {
        if (await requests.GetPendingForAsync(invoice.Id, cancellationToken) is { Module: ApprovalModule.PurchaseInvoice, Action: ApprovalAction.Create } waiting)
            return waiting;
        if (!canApprove && await receiver.OrderOfAsync(invoice, cancellationToken) is { } order)
        {
            invoice.EnsurePostable();
            PurchaseOrderReceiver.EnsureReceivable(order, invoice);
            var match = await receiver.MatchAsync(order, invoice, cancellationToken);
            if (match.NeedsApproval)
            {
                await requests.EnsureNotPendingAsync(invoice.Id, cancellationToken);
                var (summary, changes) = await receiver.DescribeAsync(order, invoice, match, cancellationToken);
                var asked = ApprovalRequest.AskToChange(
                    Guid.NewGuid(), ApprovalModule.PurchaseInvoice, ApprovalAction.Create, invoice.Id, summary, changes,
                    ApprovalPayload.Write(new PostAgainstOrder(invoice.Id, order.Id)), null, staffId, staffName);
                requests.Add(asked);
                return asked;
            }
        }
        await PostAsync(invoice, staffName, staffId, canApprove, cancellationToken);
        return null;
    }
}

internal sealed class PostPurchaseInvoiceCommandHandler(
    IPurchaseInvoiceRepository invoices,
    IRawMaterialRepository materials,
    IExpenseItemRepository expenses,
    IPurchaseCategoryRepository categories,
    ISupplierRepository suppliers,
    ISafeTransactionRepository safe,
    IApprovalRequestRepository requests,
    InvoicePoster poster,
    PurchaseOrderReceiver receiver,
    IUnitOfWork unitOfWork) : IRequestHandler<PostPurchaseInvoiceCommand, PurchaseInvoiceDto>
{
    public async Task<PurchaseInvoiceDto> Handle(PostPurchaseInvoiceCommand request, CancellationToken cancellationToken)
    {
        var reading = new InvoiceReading(materials, expenses, categories, suppliers, safe, requests, receiver);
        var invoice = await invoices.GetRequiredAsync(request.InvoiceId, cancellationToken);
        if (invoice.Status == PurchaseInvoiceStatus.Posted)
            return await reading.DtoAsync(invoice, cancellationToken);

        // Over its purchase order, anyone else's waits for a manager: AwaitingApproval says so.
        await poster.PostOrAskAsync(invoice, request.StaffName, request.StaffId, request.CanApprove, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(invoice, cancellationToken);
    }
}

public sealed record DiscardPurchaseInvoiceCommand(Guid InvoiceId) : IRequest;

internal sealed class DiscardPurchaseInvoiceCommandHandler(IPurchaseInvoiceRepository invoices, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<DiscardPurchaseInvoiceCommand>
{
    public async Task Handle(DiscardPurchaseInvoiceCommand request, CancellationToken cancellationToken)
    {
        // Already gone: a retry of a discard that worked.
        if (await invoices.GetByIdAsync(request.InvoiceId, cancellationToken) is not { } invoice)
            return;
        if (invoice.Status == PurchaseInvoiceStatus.Posted)
            throw new DomainException("A posted invoice stays: it is the record of what came in.");
        await requests.EnsureNotPendingAsync(invoice.Id, cancellationToken);

        invoices.Remove(invoice);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}

// The paper: a photo or scan of the invoice. A draft is made for it if there is none yet.
public sealed record AttachPurchaseInvoiceFileCommand(Guid InvoiceId, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<PurchaseInvoiceDto>;

internal sealed class AttachPurchaseInvoiceFileCommandHandler(
    IPurchaseInvoiceRepository invoices,
    IPurchaseAttachmentStore attachments,
    IRawMaterialRepository materials,
    IExpenseItemRepository expenses,
    IPurchaseCategoryRepository categories,
    ISupplierRepository suppliers,
    ISafeTransactionRepository safe,
    IApprovalRequestRepository requests,
    IUnitOfWork unitOfWork) : IRequestHandler<AttachPurchaseInvoiceFileCommand, PurchaseInvoiceDto>
{
    public async Task<PurchaseInvoiceDto> Handle(AttachPurchaseInvoiceFileCommand request, CancellationToken cancellationToken)
    {
        var invoice = await invoices.GetByIdAsync(request.InvoiceId, cancellationToken);
        if (invoice is null)
            invoices.Add(invoice = new PurchaseInvoice(request.InvoiceId, request.StaffName));

        if (!UploadedFile.LooksLike(request.ContentType, request.Content))
            throw new DomainException("That file is not the photo or PDF it says it is.");
        invoice.Attach(request.FileName, request.ContentType, request.Content.Length, request.StaffName);
        attachments.Put(invoice.Id, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await new InvoiceReading(materials, expenses, categories, suppliers, safe, requests).DtoAsync(invoice, cancellationToken);
    }
}

public sealed record PurchaseAttachmentFile(string FileName, string ContentType, byte[] Content);

public sealed record GetPurchaseInvoiceAttachmentQuery(Guid InvoiceId) : IRequest<PurchaseAttachmentFile?>;

internal sealed class GetPurchaseInvoiceAttachmentQueryHandler(IPurchaseInvoiceRepository invoices, IPurchaseAttachmentStore attachments)
    : IRequestHandler<GetPurchaseInvoiceAttachmentQuery, PurchaseAttachmentFile?>
{
    public async Task<PurchaseAttachmentFile?> Handle(GetPurchaseInvoiceAttachmentQuery request, CancellationToken cancellationToken)
    {
        if (await invoices.GetByIdAsync(request.InvoiceId, cancellationToken) is not { HasAttachment: true } invoice)
            return null;
        return await attachments.GetAsync(invoice.Id, cancellationToken) is { } content
            ? new PurchaseAttachmentFile(invoice.AttachmentFileName!, invoice.AttachmentContentType!, content)
            : null;
    }
}
```


`InvoiceCorrections.cs`: **تعديل فاتورة مرحّلة = فاتورة جديدة تسمّي الأصلية**، والأصلية تُلغى (بضاعتها تخرج بحركات عكسية، ونقدها يعود أو دينها يُعكس). المعاينة تعرض أثر التعديل على كل خامة. للمدير فورًا، ولغيره كطلب.

> 📄 **`backend/src/Costing.Application/Purchases/InvoiceCorrections.cs`** — 248 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Approvals;
using Costing.Domain.Expenses;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;
using Costing.Domain.Suppliers;
using Costing.Application.Books;

namespace Costing.Application.Purchases;

// A posted invoice corrected (تعديل فاتورة): entered again as it should have been, as a new
// invoice (NewInvoiceId, made by the till) that names the one it corrects. Done, the original is
// voided (its goods out of stock, its cash back where it came from, its line off its supplier's
// account) and the correction posted in its place (its goods in at the averages now, paid as it
// says, its paper kept), together: nothing posted is rewritten, and both stay, linked. Everything
// on it may change; an invoice from before the treasury stays so, touching neither the safe nor
// a supplier's account.
//
// A manager's is done at once, recorded as decided by them; anyone else's is a request, and the
// original stays as it was, locked, until a manager approves it, or rejects it with a reason.
public sealed record InvoiceCorrection(
    Guid NewInvoiceId,
    Guid? SupplierId,
    string? SupplierInvoiceNumber,
    DateOnly? InvoiceDate,
    IReadOnlyList<PurchaseInvoiceLineEntry> Lines,
    PurchasePaymentMethod? PaymentMethod,
    DateOnly? RevenueDate,
    decimal Discount = 0);

public sealed record CorrectPurchaseInvoiceCommand(
    Guid RequestId, Guid InvoiceId, InvoiceCorrection Correction, string? Reason, string StaffId, string StaffName, bool CanApprove)
    : IRequest<ApprovalResultDto>, IRetryOnConflict, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Correction.InvoiceDate, Correction.RevenueDate];
}

internal sealed class CorrectPurchaseInvoiceHandler(IApprovalRequestRepository requests, InvoiceCorrector corrector, IUnitOfWork unitOfWork)
    : IRequestHandler<CorrectPurchaseInvoiceCommand, ApprovalResultDto>
{
    public async Task<ApprovalResultDto> Handle(CorrectPurchaseInvoiceCommand request, CancellationToken cancellationToken)
    {
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } already)
            return ApprovalResultDto.Of(already);

        var original = await corrector.OriginalAsync(request.InvoiceId, cancellationToken);
        await requests.EnsureNotPendingAsync(original.Id, cancellationToken);
        var corrected = await corrector.BuildAsync(original, request.Correction, request.StaffName, track: false, cancellationToken);
        var (summary, changes) = await corrector.DescribeAsync(original, corrected, cancellationToken);
        var payload = ApprovalPayload.Write(request.Correction);

        if (!request.CanApprove)
        {
            var asked = ApprovalRequest.AskToChange(
                request.RequestId, ApprovalModule.PurchaseInvoice, ApprovalAction.Update, original.Id, summary, changes, payload, request.Reason,
                request.StaffId, request.StaffName);
            requests.Add(asked);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return ApprovalResultDto.Of(asked);
        }

        var decided = ApprovalRequest.DecidedChange(
            request.RequestId, ApprovalModule.PurchaseInvoice, ApprovalAction.Update, original.Id, summary, changes, payload, request.Reason,
            request.StaffId, request.StaffName);
        requests.Add(decided);
        await corrector.ApplyAsync(original, request.Correction, request.StaffName, request.StaffName, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return ApprovalResultDto.Of(decided);
    }
}

// What a correction would change, checked as it will be when sent: the Review changes step. The
// same lines a manager sees on the request.
public sealed record PreviewInvoiceCorrectionQuery(Guid InvoiceId, InvoiceCorrection Correction, string StaffName) : IRequest<InvoiceCorrectionPreview>;

public sealed record InvoiceCorrectionPreview(string Summary, IReadOnlyList<ApprovalChange> Changes);

internal sealed class PreviewInvoiceCorrectionHandler(IApprovalRequestRepository requests, InvoiceCorrector corrector)
    : IRequestHandler<PreviewInvoiceCorrectionQuery, InvoiceCorrectionPreview>
{
    public async Task<InvoiceCorrectionPreview> Handle(PreviewInvoiceCorrectionQuery request, CancellationToken cancellationToken)
    {
        var original = await corrector.OriginalAsync(request.InvoiceId, cancellationToken);
        await requests.EnsureNotPendingAsync(original.Id, cancellationToken);
        var corrected = await corrector.BuildAsync(original, request.Correction, request.StaffName, track: false, cancellationToken);
        var (summary, changes) = await corrector.DescribeAsync(original, corrected, cancellationToken);
        return new InvoiceCorrectionPreview(summary, changes);
    }
}

// Checks, describes and applies a correction: for a manager's own and for an approval alike.
internal sealed class InvoiceCorrector(
    IPurchaseInvoiceRepository invoices,
    InvoiceRecorder recorder,
    InvoicePoster poster,
    DeletionTargets deletions,
    IStockMovementRepository movements,
    IPurchaseAttachmentStore attachments,
    IRawMaterialRepository materials,
    IExpenseItemRepository expenses,
    ISupplierRepository suppliers)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public Task<PurchaseInvoice> OriginalAsync(Guid invoiceId, CancellationToken cancellationToken) =>
        invoices.GetRequiredAsync(invoiceId, cancellationToken);

    // The correction as a new invoice, checked as one entered and posted would be: only built
    // (track false), before a request goes to a manager; tracked, to be posted.
    public async Task<PurchaseInvoice> BuildAsync(
        PurchaseInvoice original, InvoiceCorrection change, string staffName, bool track, CancellationToken cancellationToken)
    {
        if (original.Status == PurchaseInvoiceStatus.Draft)
            throw new DomainException("This invoice is a draft: finish it instead.");
        if (original.Status == PurchaseInvoiceStatus.Voided)
            throw new DomainException(original.ReplacedBy is null
                ? "This invoice has been voided."
                : "This invoice has already been corrected: correct the invoice that replaced it.");
        var beforeTreasury = original.PaymentMethod is null or PurchasePaymentMethod.BeforeTreasury;
        if (beforeTreasury && change.PaymentMethod != PurchasePaymentMethod.BeforeTreasury)
            throw new DomainException("This invoice is from before the treasury: it is corrected as one, touching neither the safe nor a supplier's account.");
        if (!beforeTreasury && change.PaymentMethod == PurchasePaymentMethod.BeforeTreasury)
            throw new DomainException("Choose how the invoice is paid: from the safe, from a day's takings, or on credit.");

        var corrected = await recorder.CorrectionAsync(
            original,
            new SavePurchaseInvoiceCommand(
                change.NewInvoiceId, change.SupplierId, change.SupplierInvoiceNumber, change.InvoiceDate, change.Lines, staffName,
                change.PaymentMethod, change.RevenueDate, change.Discount),
            track,
            cancellationToken);
        corrected.EnsurePostable();
        // In the branch of the invoice it replaces, whoever corrects it.
        corrected.AssignBranch(original.BranchId);
        if (Same(original, corrected))
            throw new DomainException("Nothing has changed: enter the invoice as it should have been.");
        return corrected;
    }

    // Done: the original voided, replaced by the correction, posted. requestedBy entered it;
    // decidedBy, the manager who did or approved it.
    public async Task ApplyAsync(PurchaseInvoice original, InvoiceCorrection change, string requestedBy, string decidedBy, CancellationToken cancellationToken)
    {
        var corrected = await BuildAsync(original, change, requestedBy, track: true, cancellationToken);
        foreach (var reversal in await deletions.VoidInvoiceAsync(original, decidedBy, corrected.Id, cancellationToken))
            movements.Add(reversal);

        // Its paper, kept with it.
        if (original.HasAttachment && await attachments.GetAsync(original.Id, cancellationToken) is { } paper)
        {
            corrected.Attach(original.AttachmentFileName!, original.AttachmentContentType!, paper.Length, original.AttachedBy ?? decidedBy);
            attachments.Put(corrected.Id, paper);
        }

        await poster.PostAsync(corrected, decidedBy, string.Empty, canApprove: true, cancellationToken);
    }

    // "Invoice F-1 · Nile Farms corrected · L.E 400.00 → L.E 420.00", and what changes, line by line.
    public async Task<(string Summary, IReadOnlyList<ApprovalChange> Changes)> DescribeAsync(
        PurchaseInvoice original, PurchaseInvoice corrected, CancellationToken cancellationToken)
    {
        var supplierIds = new[] { original.SupplierId, corrected.SupplierId }.OfType<Guid>().Distinct().ToList();
        var supplierNames = new Dictionary<Guid, string>();
        foreach (var id in supplierIds)
            supplierNames[id] = (await suppliers.GetByIdAsync(id, cancellationToken))?.Name ?? "A removed supplier";
        string? Supplier(PurchaseInvoice i) => i.SupplierId is { } id ? supplierNames[id] : null;

        var lines = original.Lines.Concat(corrected.Lines).ToList();
        var materialIds = lines.Where(l => l.RawMaterialId != null).Select(l => l.RawMaterialId!.Value).Distinct().ToList();
        var materialNames = materialIds.Count == 0
            ? new Dictionary<Guid, string>()
            : (await materials.GetRequiredByIdsAsync(materialIds, cancellationToken)).ToDictionary(m => m.Key, m => m.Value.Name);
        var expenseIds = lines.Where(l => l.ExpenseItemId != null).Select(l => l.ExpenseItemId!.Value).Distinct().ToList();
        var expenseNames = expenseIds.Count == 0
            ? new Dictionary<Guid, string>()
            : (await expenses.GetByIdsAsync(expenseIds, cancellationToken)).ToDictionary(e => e.Id, e => e.Name);

        var changes = new List<ApprovalChange>();
        void Change(string label, string? before, string? after)
        {
            if (before != after)
                changes.Add(new ApprovalChange(label, before, after));
        }

        Change("Supplier", Supplier(original), Supplier(corrected));
        Change("Invoice no.", original.SupplierInvoiceNumber, corrected.SupplierInvoiceNumber);
        Change("Invoice date", Day(original.InvoiceDate), Day(corrected.InvoiceDate));
        Change("Paid", PaidBy(original), PaidBy(corrected));

        // Each item, as it was and as it is: added, gone, or changed.
        var before = original.Lines.ToDictionary(Key);
        var after = corrected.Lines.ToDictionary(Key);
        foreach (var key in before.Keys.Concat(after.Keys).Distinct())
        {
            var name = key.Material is { } m ? materialNames.GetValueOrDefault(m, "A removed material")
                : key.Expense is { } e ? expenseNames.GetValueOrDefault(e, "A removed expense")
                : "An item";
            Change(name, before.TryGetValue(key, out var was) ? Line(was) : null, after.TryGetValue(key, out var now) ? Line(now) : null);
        }

        Change("Invoice discount", original.Discount == 0 ? null : Money(original.Discount), corrected.Discount == 0 ? null : Money(corrected.Discount));
        changes.Add(new ApprovalChange("Total", Money(original.Total), Money(corrected.Total)));
        var what = (original.SupplierInvoiceNumber is { } number ? $"Invoice {number}" : $"Invoice of {Day(original.InvoiceDate) ?? "no date"}") +
                   (Supplier(original) is { } supplier ? $" · {supplier}" : "");
        return ($"{what} corrected · {Money(original.Total)} → {Money(corrected.Total)}", changes);
    }

    private static bool Same(PurchaseInvoice a, PurchaseInvoice b) =>
        a.SupplierId == b.SupplierId && a.SupplierInvoiceNumber == b.SupplierInvoiceNumber && a.InvoiceDate == b.InvoiceDate
        && (a.PaymentMethod ?? PurchasePaymentMethod.BeforeTreasury) == (b.PaymentMethod ?? PurchasePaymentMethod.BeforeTreasury)
        && a.RevenueDate == b.RevenueDate
        && a.Discount == b.Discount
        && a.Lines.Count == b.Lines.Count
        && a.Lines.Select(Entry).Order().SequenceEqual(b.Lines.Select(Entry).Order());

    // A line as a value to compare: amounts read back keep their trailing zeros (6.0000), so each is
    // written plainly.
    private static string Entry(PurchaseInvoiceLine l) =>
        string.Join("|", l.ItemType, l.RawMaterialId, l.ExpenseItemId, Plain(l.EnteredQuantity), l.UnitLabel, Plain(l.UnitSize),
            l.LineTotal is { } c ? Plain(c) : null, Plain(l.Discount));

    private static string Plain(decimal value) => value.ToString("0.##########", Invariant);

    private static (Guid? Material, Guid? Expense) Key(PurchaseInvoiceLine l) => (l.RawMaterialId, l.ExpenseItemId);

    // "5 kg · L.E 100.00", or "5 kg · L.E 100.00 less L.E 10.00".
    private static string Line(PurchaseInvoiceLine l) =>
        $"{l.EnteredQuantity.ToString("0.###", Invariant)}{(string.IsNullOrWhiteSpace(l.UnitLabel) ? "" : " " + l.UnitLabel)} · " +
        (l.LineTotal is { } total ? Money(total) + (l.Discount > 0 ? $" less {Money(l.Discount)}" : "") : "no price");

    private static string PaidBy(PurchaseInvoice i) => i.PaymentMethod switch
    {
        PurchasePaymentMethod.Safe => "From the safe",
        PurchasePaymentMethod.DayRevenue => $"From the takings of {Day(i.RevenueDate)}",
        PurchasePaymentMethod.Credit => "On credit",
        _ => "Before the treasury",
    };

    private static string? Day(DateOnly? day) => day?.ToString("d MMM yyyy", Invariant);

    private static string Money(decimal value) => CompanyMoney.Text(value);
}
```


### 1.4 يومية المشتريات المجمّعة (`PurchaseBatch`)

يوم مشتريات كامل مرة واحدة: التاريخ وطريقة الدفع تُختار مرة، ثم فاتورة لكل مورد، **كل واحدة فاتورة مستقلة كأنها أُدخلت وحدها** (تُرحّل، تدخل المخزون، تُدفع)، مع:

- كل فاتورة نقدي أو آجل،
- الفواتير المسلّمة في تقفيل اليوم تظهر جاهزة للنسخ من صورتها (`EndOfDayInvoiceId`)، وتُربط مرة واحدة،
- صورة الورقة تُرفع بعد الترحيل (لا تُحفظ في `localStorage`)،
- وسلف الموظفين من نفس الشاشة.

> 📄 **`backend/src/Costing.Application/Purchases/PurchaseBatch.cs`** — 306 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Domain.Staff;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.EndOfDay;
using Costing.Domain.Expenses;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;
using Costing.Application.Books;

namespace Costing.Application.Purchases;

// A day's purchases entered together (يومية المشتريات المجمعة): the date and how they were paid,
// chosen once, and an invoice for each supplier. Each is its own purchase invoice, as if entered
// alone: recorded, posted, its stock in, and paid as chosen. On credit it is owed to its supplier;
// in cash it is paid for a manager, and asked of one, a request each, for anyone else. Never one
// invoice for the lot, so each supplier's account and the safe stay exact.
//
// A supplier can be paid in it too (سداد مورد), an old debt settled with no invoice and no stock:
// from the safe or the day's takings, as the batch is paid, never on credit; against what is owed
// to them, never more, and taken off it on their account.
//
// An employee's advance (سلفة) can be paid in it as well, as a payment is: from the safe or the
// day's takings, never on credit, and owed by the employee until the payroll of its month deducts it.
//
// An invoice can be on credit in a batch paid in cash (OnCredit), owed to its supplier as one on a
// batch on credit. One handed in at the end of the day (تقفيل اليوم) names it (EndOfDayInvoiceId):
// posted, it is that invoice's purchase invoice, with its photo as its paper; on the day it was
// handed in, once, and only once the day is submitted.
//
// All or nothing: every invoice, payment and advance is checked before any is saved, and each
// problem is said by the one it is on. InvoiceId and a payment's or advance's TransactionId are
// made by the till: a batch sent again does not post an invoice, pay a supplier, or advance, twice.

public sealed record BatchInvoice(
    Guid InvoiceId,
    Guid? SupplierId,
    string? SupplierInvoiceNumber,
    IReadOnlyList<PurchaseInvoiceLineEntry> Lines,
    decimal Discount = 0,
    bool OnCredit = false,
    Guid? EndOfDayInvoiceId = null,
    // The purchase order it delivers, and whether it closes it with what came (no backorder).
    Guid? PurchaseOrderId = null,
    bool ClosesPurchaseOrder = false);

public sealed record BatchPayment(Guid TransactionId, Guid SupplierId, decimal Amount, string? Notes = null);

public sealed record BatchAdvance(Guid TransactionId, Guid? EmployeeId, decimal Amount, string? Notes = null);

// A payment the batch made (Applied), or asked of a manager (Requested): no cash moves until then.
public sealed record BatchPaymentDto(Guid TransactionId, Guid SupplierId, string Supplier, decimal Amount, string? Notes, ApprovalOutcome Outcome);

public sealed record BatchAdvanceDto(Guid TransactionId, Guid? EmployeeId, string Employee, decimal Amount, string? Notes, ApprovalOutcome Outcome);

public sealed record PurchaseBatchResult(IReadOnlyList<PurchaseInvoiceDto> Invoices, IReadOnlyList<BatchPaymentDto> Payments, IReadOnlyList<BatchAdvanceDto> Advances);

public sealed record PostPurchaseBatchCommand(
    DateOnly InvoiceDate,
    PurchasePaymentMethod PaymentMethod,
    DateOnly? RevenueDate,
    IReadOnlyList<BatchInvoice> Invoices,
    string StaffName = "",
    string StaffId = "",
    bool CanApprove = true,
    IReadOnlyList<BatchPayment>? Payments = null,
    IReadOnlyList<BatchAdvance>? Advances = null) : IRequest<PurchaseBatchResult>, IRetryOnConflict, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [InvoiceDate, RevenueDate];
}

internal sealed class PostPurchaseBatchHandler(
    IPurchaseInvoiceRepository invoices,
    InvoiceRecorder recorder,
    InvoicePoster poster,
    IRawMaterialRepository materials,
    IExpenseItemRepository expenses,
    IPurchaseCategoryRepository categories,
    ISupplierRepository suppliers,
    ISafeTransactionRepository safe,
    IApprovalRequestRepository requests,
    ISupplierLedgerRepository suppliersLedger,
    TreasuryWriter treasury,
    IStaffMemberRepository employees,
    IEndOfDayRepository endOfDays,
    IEndOfDayPhotoStore endOfDayPhotos,
    IPurchaseAttachmentStore attachments,
    PurchaseOrderReceiver receiver,
    IUnitOfWork unitOfWork) : IRequestHandler<PostPurchaseBatchCommand, PurchaseBatchResult>
{
    public const int MaxInvoices = 50;

    // What an advance handed out with no one named is called in the batch's answer.
    private const string PendingAdvances = "Advances, none named";

    public async Task<PurchaseBatchResult> Handle(PostPurchaseBatchCommand request, CancellationToken cancellationToken)
    {
        var payments = request.Payments ?? [];
        var advances = request.Advances ?? [];
        if (request.Invoices.Count == 0 && payments.Count == 0 && advances.Count == 0)
            throw new DomainException("Add an invoice, a supplier payment or an advance to the batch.");
        if (request.Invoices.Count + payments.Count + advances.Count > MaxInvoices)
            throw new DomainException($"A batch holds at most {MaxInvoices} invoices, payments and advances: send the rest as another.");
        if (request.PaymentMethod == PurchasePaymentMethod.BeforeTreasury)
            throw new DomainException("Before the treasury is for the invoices from before it, not for new ones.");
        if (request.Invoices.Select(i => i.InvoiceId).Distinct().Count() != request.Invoices.Count)
            throw new DomainException("The same invoice is in the batch twice.");
        var handedIn = request.Invoices.Where(i => i.EndOfDayInvoiceId is not null).Select(i => i.EndOfDayInvoiceId).ToList();
        if (handedIn.Distinct().Count() != handedIn.Count)
            throw new DomainException("The same invoice handed in at the end of the day is in the batch twice. · فاتورة التقفيل مكررة.");
        if (payments.Count > 0 || advances.Count > 0)
        {
            if (request.PaymentMethod == PurchasePaymentMethod.Credit)
                throw new DomainException(payments.Count > 0
                    ? "A supplier payment is cash: pay the batch from the safe or a day's takings, or send the payments apart."
                    : "An advance is cash: pay the batch from the safe or a day's takings, or send the advances apart.");
            if (request.PaymentMethod == PurchasePaymentMethod.DayRevenue && request.RevenueDate is null)
                throw new DomainException("Choose the day whose takings pay them.");
            var ids = payments.Select(p => p.TransactionId).Concat(advances.Select(a => a.TransactionId)).Concat(request.Invoices.Select(i => i.InvoiceId)).ToList();
            if (ids.Distinct().Count() != ids.Count)
                throw new DomainException("The same payment is in the batch twice.");
        }

        var made = new List<PurchaseInvoice>();
        var problems = new List<string>();
        for (var i = 0; i < request.Invoices.Count; i++)
        {
            var entry = request.Invoices[i];
            try
            {
                // Sent again after an answer was lost: posted already, it is not posted twice; or
                // asked of a manager already, against its purchase order.
                if (await invoices.GetByIdAsync(entry.InvoiceId, cancellationToken) is { } existing
                    && (existing.Status == PurchaseInvoiceStatus.Posted || await requests.GetPendingForAsync(existing.Id, cancellationToken) is not null))
                {
                    made.Add(existing);
                    continue;
                }

                if (entry.Lines.Count == 0)
                    throw new DomainException("It has no lines: add what was bought, or take the invoice off the batch.");
                var day = entry.EndOfDayInvoiceId is { } given ? await HandedInAsync(given, entry.InvoiceId, request.InvoiceDate, cancellationToken) : null;
                var method = entry.OnCredit ? PurchasePaymentMethod.Credit : request.PaymentMethod;
                var invoice = await recorder.RecordAsync(
                    new SavePurchaseInvoiceCommand(
                        entry.InvoiceId, entry.SupplierId, entry.SupplierInvoiceNumber, request.InvoiceDate, entry.Lines, request.StaffName,
                        method, method == PurchasePaymentMethod.DayRevenue ? request.RevenueDate : null, entry.Discount,
                        entry.PurchaseOrderId ?? day?.Invoice(entry.EndOfDayInvoiceId!.Value).PurchaseOrderId, entry.ClosesPurchaseOrder),
                    cancellationToken);
                // Over its purchase order, anyone else's waits for a manager, a draft until then.
                await poster.PostOrAskAsync(invoice, request.StaffName, request.StaffId, request.CanApprove, cancellationToken);
                if (day is not null)
                    await PostedFromAsync(day, entry.EndOfDayInvoiceId!.Value, invoice, request.StaffName, cancellationToken);
                made.Add(invoice);
            }
            catch (Exception error) when (error is DomainException or NotFoundException)
            {
                var supplier = entry.SupplierId is { } id ? (await suppliers.GetByIdAsync(id, cancellationToken))?.Name : null;
                problems.Add($"Invoice {i + 1}{(supplier is null ? "" : $" · {supplier}")}: {error.Message}");
            }
        }

        var paid = new List<BatchPaymentDto>();
        // What each supplier is still owed as the payments above it are taken off.
        var owedLeft = new Dictionary<Guid, decimal>();
        for (var i = 0; i < payments.Count; i++)
        {
            var entry = payments[i];
            var name = (await suppliers.GetByIdAsync(entry.SupplierId, cancellationToken))?.Name;
            try
            {
                // Sent again after an answer was lost: paid, or asked, already.
                var paidAlready = await safe.GetByIdAsync(entry.TransactionId, cancellationToken) is not null;
                if (paidAlready || await requests.GetByIdAsync(entry.TransactionId, cancellationToken) is not null)
                {
                    var outcome = paidAlready ? ApprovalOutcome.Applied : ApprovalOutcome.Requested;
                    paid.Add(new BatchPaymentDto(entry.TransactionId, entry.SupplierId, name ?? "", entry.Amount, entry.Notes, outcome));
                    continue;
                }

                if (name is null)
                    throw new NotFoundException("Supplier", entry.SupplierId);
                if (entry.Amount <= 0)
                    throw new DomainException("Enter an amount more than nothing.");
                var after = owedLeft.ContainsKey(entry.SupplierId);
                var owed = after ? owedLeft[entry.SupplierId] : await suppliersLedger.BalanceAsync(entry.SupplierId, cancellationToken);
                if (entry.Amount > owed)
                    throw new DomainException(owed > 0
                        ? $"{name} is owed {Money(owed)}{(after ? " after the payments above" : "")}: pay that much or less."
                        : $"Nothing is owed to {name}{(after ? " after the payments above" : "")}.");
                owedLeft[entry.SupplierId] = owed - entry.Amount;

                var voucher = new SafeVoucher(
                    entry.TransactionId, SafeTransactionKind.SupplierPayment, entry.Amount, request.InvoiceDate,
                    RevenueDate: request.PaymentMethod == PurchasePaymentMethod.DayRevenue ? request.RevenueDate : null,
                    SupplierId: entry.SupplierId, Notes: entry.Notes);
                if (request.CanApprove)
                {
                    await treasury.ApplyAsync(voucher, request.StaffName, null, cancellationToken);
                    paid.Add(new BatchPaymentDto(entry.TransactionId, entry.SupplierId, name, entry.Amount, voucher.Notes?.Trim(), ApprovalOutcome.Applied));
                }
                else
                {
                    await treasury.CheckAsync(voucher, cancellationToken);
                    var (summary, changes) = await treasury.DescribeAsync(voucher, cancellationToken);
                    requests.Add(ApprovalRequest.AskToChange(
                        entry.TransactionId, ApprovalModule.Treasury, ApprovalAction.Create, entry.TransactionId, summary, changes,
                        ApprovalPayload.Write(voucher), null, request.StaffId, request.StaffName));
                    paid.Add(new BatchPaymentDto(entry.TransactionId, entry.SupplierId, name, entry.Amount, voucher.Notes?.Trim(), ApprovalOutcome.Requested));
                }
            }
            catch (Exception error) when (error is DomainException or NotFoundException)
            {
                problems.Add($"Payment {i + 1}{(name is null ? "" : $" · {name}")}: {error.Message}");
            }
        }

        var advanced = new List<BatchAdvanceDto>();
        for (var i = 0; i < advances.Count; i++)
        {
            var entry = advances[i];
            // No one named: advances handed out as a lump sum, given out on HR → Advances.
            var name = entry.EmployeeId is { } advancedTo ? (await employees.GetByIdAsync(advancedTo, cancellationToken))?.Name : PendingAdvances;
            try
            {
                // Sent again after an answer was lost: paid, or asked, already.
                var paidAlready = await safe.GetByIdAsync(entry.TransactionId, cancellationToken) is not null;
                if (paidAlready || await requests.GetByIdAsync(entry.TransactionId, cancellationToken) is not null)
                {
                    var outcome = paidAlready ? ApprovalOutcome.Applied : ApprovalOutcome.Requested;
                    advanced.Add(new BatchAdvanceDto(entry.TransactionId, entry.EmployeeId, name ?? "", entry.Amount, entry.Notes, outcome));
                    continue;
                }

                var voucher = new SafeVoucher(
                    entry.TransactionId, SafeTransactionKind.EmployeeAdvance, entry.Amount, request.InvoiceDate,
                    RevenueDate: request.PaymentMethod == PurchasePaymentMethod.DayRevenue ? request.RevenueDate : null,
                    Notes: entry.Notes, EmployeeId: entry.EmployeeId);
                if (request.CanApprove)
                {
                    await treasury.ApplyAsync(voucher, request.StaffName, null, cancellationToken);
                    advanced.Add(new BatchAdvanceDto(entry.TransactionId, entry.EmployeeId, name!, entry.Amount, voucher.Notes?.Trim(), ApprovalOutcome.Applied));
                }
                else
                {
                    await treasury.CheckAsync(voucher, cancellationToken);
                    var (summary, changes) = await treasury.DescribeAsync(voucher, cancellationToken);
                    requests.Add(ApprovalRequest.AskToChange(
                        entry.TransactionId, ApprovalModule.Treasury, ApprovalAction.Create, entry.TransactionId, summary, changes,
                        ApprovalPayload.Write(voucher), null, request.StaffId, request.StaffName));
                    advanced.Add(new BatchAdvanceDto(entry.TransactionId, entry.EmployeeId, name!, entry.Amount, voucher.Notes?.Trim(), ApprovalOutcome.Requested));
                }
            }
            catch (Exception error) when (error is DomainException or NotFoundException)
            {
                problems.Add($"Advance {i + 1}{(name is null ? "" : $" · {name}")}: {error.Message}");
            }
        }

        if (problems.Count > 0)
            throw new DomainException(string.Join("\n", problems));

        await unitOfWork.SaveChangesAsync(cancellationToken);
        var reading = new InvoiceReading(materials, expenses, categories, suppliers, safe, requests, receiver);
        var dtos = new List<PurchaseInvoiceDto>();
        foreach (var invoice in made)
            dtos.Add(await reading.DtoAsync(invoice, cancellationToken));
        return new PurchaseBatchResult(dtos, paid, advanced);
    }

    // The day an invoice was handed in on: submitted, of the batch's date, and not posted as another.
    private async Task<EndOfDayReport> HandedInAsync(Guid handedIn, Guid invoiceId, DateOnly invoiceDate, CancellationToken cancellationToken)
    {
        var day = await endOfDays.GetByInvoiceAsync(handedIn, cancellationToken)
            ?? throw new DomainException("The invoice handed in at the end of the day is not there any more: reload the batch. · فاتورة التقفيل لم تعد موجودة.");
        if (!day.IsSubmitted)
            throw new DomainException("Its end of day is not submitted yet: it is posted once it is handed in. · لم يتم إرسال تقفيل هذا اليوم بعد.");
        if (day.Date != invoiceDate)
            throw new DomainException(
                $"It was handed in at the end of {day.Date.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}: post it with that date. · سجّلها بتاريخ يومها.");
        if (day.Invoice(handedIn).PurchaseInvoiceId is { } posted && posted != invoiceId)
            throw new DomainException("It is posted already, as another purchase invoice. · مرحلة بالفعل في فاتورة أخرى.");
        return day;
    }

    // Posted: the invoice handed in is this one, and its photo, its paper.
    private async Task PostedFromAsync(EndOfDayReport day, Guid handedIn, PurchaseInvoice invoice, string staffName, CancellationToken cancellationToken)
    {
        var given = day.Invoice(handedIn);
        day.Posted(handedIn, invoice.Id);
        if (!invoice.HasAttachment && await endOfDayPhotos.GetAsync(handedIn, cancellationToken) is { } photo)
        {
            invoice.Attach(given.PhotoFileName, given.PhotoContentType, photo.Length, staffName);
            attachments.Put(invoice.Id, photo);
        }
    }

    private static string Money(decimal value) => CompanyMoney.Text(value);
}
```


### 1.4.1 أوامر الشراء والمطابقة الثلاثية (`PurchaseOrder`، `ThreeWayMatch`)

أمر الشراء يمر بـ: مسودة ← معتمد (المدير فورًا، وغيره طلب موافقة `ApprovalModule.PurchaseOrder`) ← استلام جزئي ← مكتمل، أو ملغى قبل أن يصل شيء. **الكمية المستلمة لا تُكتب يدويًا أبدًا**: بعد كل ترحيل أو إلغاء لفاتورة تحمل `PurchaseOrderId` يُعاد عدّها من الفواتير المرحلة (`PurchaseOrderReceiver.RecountAsync`)، فالإلغاء والتعديل يصححان الأمر تلقائيًا، وإلغاء الفاتورة التي أغلقته يعيد فتحه.

```text
المستلم بوحدة الشراء = كمية البند بوحدة الخامة ÷ حجم وحدة الشراء
صافي سعر الوحدة      = (إجمالي البند − خصمه − نصيبه من خصم الفاتورة) ÷ المستلم
زيادة سعر            = صافي السعر > السعر المتوقع × (1 + 0.5%) وبقرش على الأقل
كمية زائدة           = المستلم > المتبقي (والصنف غير المطلوب كله زائد)
استلام جزئي          = المستلم < المتبقي
```

**بوابة الموافقة** في `InvoicePoster.PostOrAskAsync`: لغير المدير، فاتورة على أمر شراء فيها زيادة سعر أو كمية لا تُرحَّل؛ تبقى مسودة (لا مخزون ولا متوسط تكلفة) ويُرسل طلب `PurchaseInvoice/Create` بتفاصيل الفرق، وعند الموافقة تُرحَّل كما أُدخلت بـ `PostAsync`. لماذا البوابة خارج `PostAsync`؟ لأن طريق الموافقة نفسه والتعديلات يرحّلان دون سؤال جديد.

> 📄 **`backend/src/Costing.Domain/Purchases/PurchaseOrder.cs`** — 373 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Domain.Purchases;

// Where a purchase order stands.
public enum PurchaseOrderStatus
{
    // Being written: changed freely, nothing ordered yet.
    Draft = 1,

    // Approved by a manager (أمر شراء معتمد): sent to the supplier, open for deliveries.
    Approved = 2,

    // Part of it delivered (استلام جزئي): the rest still open, a backorder.
    PartiallyReceived = 3,

    // All of it delivered, or closed with what came (مكتمل).
    Completed = 4,

    // Called off before anything came (ملغى).
    Cancelled = 5,
}

// How the supplier is to be paid for it: a delivery's invoice is paid so unless it says otherwise.
public enum PurchaseOrderTerms
{
    Cash = 1,
    Credit = 2,
}

// One line as it is ordered: how many of the material's purchase unit, at what price each.
public sealed record PurchaseOrderLineEntry(Guid RawMaterialId, decimal OrderedPurchaseQty, decimal ExpectedUnitCost, string? LineNotes = null);

// A purchase order (أمر شراء): what is ordered from one supplier, at what price, and by when. Written
// as a draft, approved by a manager, then received against the supplier's invoices (ThreeWayMatch):
// each posted invoice that names it (PurchaseInvoice.PurchaseOrderId) adds what it brought to each
// line's received quantity, and a voided one takes it back (Recount). Fully received, it is complete;
// received in part, the rest stays open as a backorder, or is closed with what came (Close).
//
// Its number is PO-year-sequence, the year it is ordered in: PO-2026-0001.
public sealed class PurchaseOrder : AggregateRoot
{
    public const int MaxLines = 100;
    public const int MaxNotesLength = 500;
    public const int MaxLineNotesLength = 200;

    // Quantities are kept to the thousandth of a purchase unit, as stock is.
    private const decimal Unit = 0.0005m;

    private readonly List<PurchaseOrderLine> _lines = [];

    private PurchaseOrder() { }

    public PurchaseOrder(
        Guid id, int sequence, Guid supplierId, DateOnly orderDate, DateOnly? expectedDeliveryDate, PurchaseOrderTerms paymentTerms, string? notes,
        IReadOnlyList<PurchaseOrderLineEntry> lines, string createdByUserId, string createdBy)
    {
        if (sequence <= 0)
            throw new DomainException("A purchase order's number is 1 or more.");
        Id = id;
        Year = orderDate.Year;
        Sequence = sequence;
        PoNumber = NumberOf(Year, sequence);
        Status = PurchaseOrderStatus.Draft;
        CreatedByUserId = createdByUserId;
        CreatedBy = createdBy;
        CreatedAtUtc = DateTime.UtcNow;
        Write(supplierId, orderDate, expectedDeliveryDate, paymentTerms, notes, lines);
    }

    public int Year { get; private set; }
    public int Sequence { get; private set; }
    public string PoNumber { get; private set; } = string.Empty;

    public Guid SupplierId { get; private set; }
    public DateOnly OrderDate { get; private set; }
    public DateOnly? ExpectedDeliveryDate { get; private set; }
    public PurchaseOrderTerms PaymentTerms { get; private set; }
    public string? Notes { get; private set; }
    public PurchaseOrderStatus Status { get; private set; }

    public string CreatedByUserId { get; private set; } = string.Empty;
    public string CreatedBy { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public string? ApprovedByUserId { get; private set; }
    public string? ApprovedBy { get; private set; }
    public DateTime? ApprovedAtUtc { get; private set; }
    public DateTime? CancelledAtUtc { get; private set; }
    public string? CancelledBy { get; private set; }

    // Closed with what was received (إغلاق بالكمية المستلمة): by the invoice that closed it, or by hand.
    public DateTime? ClosedAtUtc { get; private set; }
    public string? ClosedBy { get; private set; }
    public Guid? ClosedByInvoiceId { get; private set; }

    public IReadOnlyList<PurchaseOrderLine> Lines => _lines.OrderBy(l => l.Position).ToList();

    // Open for deliveries: approved, and not complete or cancelled.
    public bool IsOpen => Status is PurchaseOrderStatus.Approved or PurchaseOrderStatus.PartiallyReceived;

    public decimal ExpectedTotal => Round(_lines.Sum(l => l.LineTotal));
    public decimal RemainingValue => Round(_lines.Sum(l => l.RemainingQty * l.ExpectedUnitCost));

    public static string NumberOf(int year, int sequence) => $"PO-{year:0000}-{sequence:0000}";

    public PurchaseOrderLine? LineFor(Guid rawMaterialId) => _lines.SingleOrDefault(l => l.RawMaterialId == rawMaterialId);

    // A draft rewritten: its supplier, dates, terms, notes and lines.
    public void Change(
        Guid supplierId, DateOnly orderDate, DateOnly? expectedDeliveryDate, PurchaseOrderTerms paymentTerms, string? notes,
        IReadOnlyList<PurchaseOrderLineEntry> lines)
    {
        if (Status != PurchaseOrderStatus.Draft)
            throw new DomainException($"{PoNumber} is {StatusName(Status)}: only a draft is changed. · لا يُعدل إلا أمر الشراء المسودة.");
        if (orderDate.Year != Year)
            throw new DomainException($"{PoNumber} is numbered in {Year}: keep its order date in that year, or write a new one.");
        Write(supplierId, orderDate, expectedDeliveryDate, paymentTerms, notes, lines);
    }

    public void Approve(string userId, string by)
    {
        if (Status != PurchaseOrderStatus.Draft)
            throw new DomainException($"{PoNumber} is {StatusName(Status)} already. · أمر الشراء معتمد بالفعل.");
        Status = PurchaseOrderStatus.Approved;
        ApprovedByUserId = userId;
        ApprovedBy = by;
        ApprovedAtUtc = DateTime.UtcNow;
    }

    // Called off before anything came; once something has, the rest is closed instead.
    public void Cancel(string by)
    {
        if (Status is not (PurchaseOrderStatus.Draft or PurchaseOrderStatus.Approved))
            throw new DomainException(Status == PurchaseOrderStatus.PartiallyReceived
                ? $"Part of {PoNumber} has come: close it with what was received instead. · أغلق أمر الشراء بالكمية المستلمة."
                : $"{PoNumber} is {StatusName(Status)}: it cannot be cancelled.");
        if (_lines.Any(l => l.ReceivedPurchaseQty > 0))
            throw new DomainException($"Part of {PoNumber} has come: close it with what was received instead.");
        Status = PurchaseOrderStatus.Cancelled;
        CancelledAtUtc = DateTime.UtcNow;
        CancelledBy = by;
    }

    // Closed with what came: the rest is not expected any more. invoiceId: the invoice that closed it
    // as it was received; none, by hand.
    public void Close(string by, Guid? invoiceId = null)
    {
        if (!IsOpen)
            throw new DomainException($"{PoNumber} is {StatusName(Status)}: only an open purchase order is closed.");
        ClosedAtUtc = DateTime.UtcNow;
        ClosedBy = by;
        ClosedByInvoiceId = invoiceId;
        Status = PurchaseOrderStatus.Completed;
    }

    // What its posted invoices brought, by material in purchase units, counted again after one is
    // posted or voided. closingInvoiceStands: whether the invoice that closed it is still posted;
    // voided, the order is open again. Complete once every line has come in full, or closed.
    public void Recount(IReadOnlyDictionary<Guid, decimal> received, bool closingInvoiceStands = true)
    {
        foreach (var line in _lines)
            line.Received(received.GetValueOrDefault(line.RawMaterialId));
        if (Status is PurchaseOrderStatus.Draft or PurchaseOrderStatus.Cancelled)
            return;
        if (ClosedByInvoiceId is not null && !closingInvoiceStands)
        {
            ClosedAtUtc = null;
            ClosedBy = null;
            ClosedByInvoiceId = null;
        }
        Status = ClosedAtUtc is not null || _lines.All(l => l.RemainingQty <= Unit)
            ? PurchaseOrderStatus.Completed
            : _lines.Any(l => l.ReceivedPurchaseQty > 0) ? PurchaseOrderStatus.PartiallyReceived : PurchaseOrderStatus.Approved;
    }

    private void Write(
        Guid supplierId, DateOnly orderDate, DateOnly? expectedDeliveryDate, PurchaseOrderTerms paymentTerms, string? notes,
        IReadOnlyList<PurchaseOrderLineEntry> lines)
    {
        if (supplierId == Guid.Empty)
            throw new DomainException("Choose the supplier it is ordered from. · اختر المورد.");
        if (expectedDeliveryDate < orderDate)
            throw new DomainException("It is expected on the day it is ordered or after. · تاريخ التوريد بعد تاريخ الطلب.");
        if (!Enum.IsDefined(paymentTerms))
            throw new DomainException("Say how it is paid: cash or credit. · نقدي أو آجل.");
        if (notes?.Trim().Length > MaxNotesLength)
            throw new DomainException($"Keep the notes under {MaxNotesLength} characters.");
        if (lines.Count == 0)
            throw new DomainException("Order at least one item. · أضف صنفًا واحدًا على الأقل.");
        if (lines.Count > MaxLines)
            throw new DomainException($"A purchase order holds {MaxLines} lines at most.");
        if (lines.Select(l => l.RawMaterialId).Distinct().Count() != lines.Count)
            throw new DomainException("Each item goes on the order once: add its quantities together. · كل صنف مرة واحدة.");

        // A line kept keeps what has come of it (nothing, on a draft) and its id.
        var kept = _lines.ToDictionary(l => l.RawMaterialId);
        var written = lines.Select((entry, i) =>
        {
            var line = kept.GetValueOrDefault(entry.RawMaterialId) ?? new PurchaseOrderLine(Id, entry.RawMaterialId);
            line.Set(entry, i);
            return line;
        }).ToList();

        SupplierId = supplierId;
        OrderDate = orderDate;
        ExpectedDeliveryDate = expectedDeliveryDate;
        PaymentTerms = paymentTerms;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        _lines.Clear();
        _lines.AddRange(written);
    }

    public static string StatusName(PurchaseOrderStatus status) => status switch
    {
        PurchaseOrderStatus.Draft => "a draft",
        PurchaseOrderStatus.Approved => "approved",
        PurchaseOrderStatus.PartiallyReceived => "partly received",
        PurchaseOrderStatus.Completed => "complete",
        _ => "cancelled",
    };

    private static decimal Round(decimal amount) => Math.Round(amount, 2, MidpointRounding.AwayFromZero);
}

public sealed class PurchaseOrderLine : Entity
{
    private PurchaseOrderLine() { }

    internal PurchaseOrderLine(Guid purchaseOrderId, Guid rawMaterialId)
    {
        PurchaseOrderId = purchaseOrderId;
        RawMaterialId = rawMaterialId;
    }

    public Guid PurchaseOrderId { get; private set; }
    public Guid RawMaterialId { get; private set; }
    public int Position { get; private set; }

    // In the material's purchase unit (kg, a carton): ordered, and come so far on posted invoices.
    public decimal OrderedPurchaseQty { get; private set; }
    public decimal ReceivedPurchaseQty { get; private set; }

    // What one purchase unit is expected to cost, net (the latest price paid, or the vendor matrix's).
    public decimal ExpectedUnitCost { get; private set; }
    public string? LineNotes { get; private set; }

    public decimal RemainingQty => Math.Max(OrderedPurchaseQty - ReceivedPurchaseQty, 0);
    public decimal LineTotal => Math.Round(OrderedPurchaseQty * ExpectedUnitCost, 2, MidpointRounding.AwayFromZero);

    internal void Set(PurchaseOrderLineEntry entry, int position)
    {
        if (entry.RawMaterialId == Guid.Empty)
            throw new DomainException("Choose the item for each line. · اختر الصنف.");
        if (entry.OrderedPurchaseQty <= 0 || entry.OrderedPurchaseQty > 1_000_000)
            throw new DomainException("Order more than nothing of each item. · الكمية أكبر من صفر.");
        if (entry.ExpectedUnitCost < 0)
            throw new DomainException("An expected price is zero or more. · السعر صفر أو أكثر.");
        if (entry.LineNotes?.Trim().Length > PurchaseOrder.MaxLineNotesLength)
            throw new DomainException($"Keep each line's notes under {PurchaseOrder.MaxLineNotesLength} characters.");
        Position = position;
        OrderedPurchaseQty = Math.Round(entry.OrderedPurchaseQty, 3, MidpointRounding.AwayFromZero);
        ExpectedUnitCost = Math.Round(entry.ExpectedUnitCost, 4, MidpointRounding.AwayFromZero);
        LineNotes = string.IsNullOrWhiteSpace(entry.LineNotes) ? null : entry.LineNotes.Trim();
    }

    internal void Received(decimal quantity) => ReceivedPurchaseQty = Math.Round(Math.Max(quantity, 0), 3, MidpointRounding.AwayFromZero);
}

// How one item of a delivery stands against its purchase order.
public enum MatchStatus
{
    // As ordered, at the price ordered (مطابق).
    Matched = 1,

    // Billed above the price ordered, beyond the tolerance (زيادة سعر).
    PriceOvercharge = 2,

    // More came than was left to come (كمية زائدة).
    QtyOver = 3,

    // Less came than was left to come (استلام جزئي): the rest a backorder, or closed.
    Short = 4,

    // On the invoice, not on the order at all (غير مطلوب).
    NotOrdered = 5,
}

// One item of a delivery against its order: what was ordered and was left to come, what came, the
// price ordered against the net price billed, and how it stands. A line can be over on both price
// and quantity: Status is the first of QtyOver or NotOrdered, PriceOvercharge, Short, Matched.
public sealed record MatchLine(
    Guid RawMaterialId,
    decimal Ordered,
    decimal Remaining,
    decimal Received,
    decimal ExpectedUnitCost,
    decimal? NetUnitPrice,
    decimal? UnitOvercharge,
    decimal Overcharge,
    decimal QtyOver,
    decimal ShortBy,
    bool PriceOver,
    MatchStatus Status);

// A delivery against its order: each item, what was billed above the prices ordered, and whether a
// manager must sign it off (an overcharge or more than was ordered) before its stock goes in.
public sealed record MatchResult(IReadOnlyList<MatchLine> Lines, decimal Overcharge, decimal QtyOverLines, bool HasShort, bool NeedsApproval);

// What came in on a delivery of a material: in its purchase units, at what it cost net of every discount.
public sealed record DeliveredItem(Guid RawMaterialId, decimal PurchaseQty, decimal? NetCost);

// The 3-way match (المطابقة الثلاثية): the purchase order (what was ordered, at what price), the goods
// received (the quantity on the invoice, as counted at the door) and the supplier's invoice (what each
// line is billed, net of its discounts):
//
//   Net unit price = line cost after every discount ÷ quantity received in purchase units
//   Overcharge     = net unit price > expected unit cost × (1 + 0.5%), and at least a piastre more
//   Over-delivery  = quantity received > what was left to come
//   Short          = quantity received < what was left to come
//
// An item not on the order is an over-delivery of all of it. What was left to come is ordered less
// what earlier posted invoices brought.
public static class ThreeWayMatch
{
    public const decimal PriceTolerancePercent = 0.5m;
    private const decimal Unit = 0.0005m;

    public static MatchResult Compare(PurchaseOrder order, IReadOnlyList<DeliveredItem> delivered)
    {
        var byMaterial = delivered.GroupBy(d => d.RawMaterialId)
            .ToDictionary(g => g.Key, g => (Qty: g.Sum(d => d.PurchaseQty), Cost: g.Any(d => d.NetCost is not null) ? g.Sum(d => d.NetCost ?? 0) : (decimal?)null));
        var lines = new List<MatchLine>();
        foreach (var line in order.Lines)
        {
            var (qty, cost) = byMaterial.GetValueOrDefault(line.RawMaterialId);
            lines.Add(Line(line.RawMaterialId, line.OrderedPurchaseQty, line.RemainingQty, qty, line.ExpectedUnitCost, cost));
        }
        foreach (var (material, (qty, cost)) in byMaterial.Where(d => order.LineFor(d.Key) is null))
            lines.Add(Line(material, 0, 0, qty, 0, cost, notOrdered: true));

        return new MatchResult(
            lines, Math.Round(lines.Sum(l => l.Overcharge), 2, MidpointRounding.AwayFromZero), lines.Count(l => l.QtyOver > 0),
            lines.Any(l => l.ShortBy > 0), lines.Any(l => l.PriceOver || l.QtyOver > 0));
    }

    private static MatchLine Line(Guid material, decimal ordered, decimal remaining, decimal received, decimal expected, decimal? cost, bool notOrdered = false)
    {
        decimal? net = received > 0 && cost is { } c ? Math.Round(c / received, 4, MidpointRounding.AwayFromZero) : null;
        var priceOver = !notOrdered && expected > 0 && net is { } price
            && price > expected * (1 + PriceTolerancePercent / 100) && Math.Round(price - expected, 2, MidpointRounding.AwayFromZero) >= 0.01m;
        decimal? unitOver = priceOver ? net - expected : null;
        var over = Math.Max(received - remaining, 0);
        var shortBy = notOrdered ? 0 : Math.Max(remaining - received, 0);
        var status = notOrdered ? MatchStatus.NotOrdered
            : over > Unit ? MatchStatus.QtyOver
            : priceOver ? MatchStatus.PriceOvercharge
            : shortBy > Unit ? MatchStatus.Short
            : MatchStatus.Matched;
        return new MatchLine(
            material, ordered, remaining, Math.Round(received, 3), expected, net, unitOver,
            priceOver ? Math.Round(unitOver!.Value * received, 2, MidpointRounding.AwayFromZero) : 0,
            over > Unit ? Math.Round(over, 3) : 0, shortBy > Unit ? Math.Round(shortBy, 3) : 0, priceOver, status);
    }
}

public interface IPurchaseOrderRepository : IRepository<PurchaseOrder>
{
    // Every purchase order, newest first, with its lines.
    Task<IReadOnlyList<PurchaseOrder>> GetAllAsync(CancellationToken cancellationToken = default);

    // The next number in the year, purchase orders added in this unit of work counted.
    Task<int> NextSequenceAsync(int year, CancellationToken cancellationToken = default);
}
```


> 📄 **`backend/src/Costing.Application/Purchases/PurchaseOrders.cs`** — 584 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Suppliers;

namespace Costing.Application.Purchases;

// Purchase orders (أوامر الشراء): written as drafts (by hand, or from the order planner a supplier
// each), approved by a manager (anyone else's asked of one), sent to the supplier, then received
// against the supplier's invoices with the 3-way match (ThreeWayMatch). What each line has received
// is counted from the posted invoices that name the order (PurchaseOrderReceiver), so a voided or
// corrected invoice puts it right by itself. Ids are made by the till.

public sealed record PurchaseOrderLineDto(
    Guid Id,
    Guid RawMaterialId,
    string? Code,
    string Material,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    UnitOfMeasure Unit,
    decimal OrderedPurchaseQty,
    decimal ReceivedPurchaseQty,
    decimal RemainingQty,
    decimal ExpectedUnitCost,
    decimal LineTotal,
    string? LineNotes);

// An invoice received against the order: posted (or voided since), or waiting for a manager to
// sign its differences off; with its paper, when it has one.
public sealed record PurchaseOrderDelivery(
    Guid InvoiceId,
    string? SupplierInvoiceNumber,
    DateOnly? InvoiceDate,
    PurchaseInvoiceStatus Status,
    decimal Total,
    DateTime? PostedAtUtc,
    string? PostedBy,
    string? AttachmentFileName,
    bool ClosedTheOrder,
    bool AwaitingApproval);

public sealed record PurchaseOrderDto(
    Guid Id,
    string PoNumber,
    Guid SupplierId,
    string Supplier,
    string? SupplierPhone,
    DateOnly OrderDate,
    DateOnly? ExpectedDeliveryDate,
    PurchaseOrderTerms PaymentTerms,
    string? Notes,
    PurchaseOrderStatus Status,
    string CreatedBy,
    DateTime CreatedAtUtc,
    string? ApprovedBy,
    DateTime? ApprovedAtUtc,
    string? CancelledBy,
    DateTime? CancelledAtUtc,
    string? ClosedBy,
    DateTime? ClosedAtUtc,
    decimal ExpectedTotal,
    decimal RemainingValue,
    // How much of what was ordered has come, by expected value.
    decimal ReceivedPercent,
    IReadOnlyList<PurchaseOrderLineDto> Lines,
    IReadOnlyList<PurchaseOrderDelivery> Deliveries);

public sealed record PurchaseOrderSummaryDto(
    Guid Id,
    string PoNumber,
    Guid SupplierId,
    string Supplier,
    DateOnly OrderDate,
    DateOnly? ExpectedDeliveryDate,
    PurchaseOrderTerms PaymentTerms,
    PurchaseOrderStatus Status,
    int Lines,
    decimal ExpectedTotal,
    decimal RemainingValue,
    decimal ReceivedPercent,
    int Deliveries,
    string CreatedBy,
    string? ApprovedBy,
    // Late: open, and its expected day gone.
    bool Overdue);

// One item of a delivery against its order, named, for the screens and the manager.
public sealed record MatchLineDto(
    Guid RawMaterialId,
    string Material,
    string PurchaseUnit,
    decimal Ordered,
    decimal Remaining,
    decimal Received,
    decimal ExpectedUnitCost,
    decimal? NetUnitPrice,
    decimal? UnitOvercharge,
    decimal Overcharge,
    decimal QtyOver,
    decimal ShortBy,
    bool PriceOver,
    MatchStatus Status);

// An invoice against the order it delivers: how each item stands (a draft's, before it is posted),
// what was overbilled, whether a manager signs it off, and whether it closes the order.
public sealed record PurchaseOrderMatchDto(
    Guid PurchaseOrderId,
    string PoNumber,
    PurchaseOrderStatus Status,
    bool Closes,
    IReadOnlyList<MatchLineDto>? Lines,
    decimal Overcharge,
    bool HasShort,
    bool NeedsApproval);

public sealed record PurchaseOrderSaved(Guid Id, string PoNumber, PurchaseOrderStatus Status, ApprovalOutcome Outcome, ApprovalRequestDto? Request = null);

// Reads purchase orders for the screens: names, units and deliveries.
internal sealed class PurchaseOrderReading(
    IRawMaterialRepository materials, ISupplierRepository suppliers, IPurchaseInvoiceRepository invoices, IApprovalRequestRepository requests)
{
    public async Task<PurchaseOrderDto> DtoAsync(PurchaseOrder order, CancellationToken cancellationToken)
    {
        var byId = (await materials.GetByIdsAsync(order.Lines.Select(l => l.RawMaterialId), cancellationToken)).ToDictionary(m => m.Id);
        var supplier = await suppliers.GetByIdAsync(order.SupplierId, cancellationToken);
        var pending = (await requests.GetPendingAsync(cancellationToken))
            .Where(r => r.Module == ApprovalModule.PurchaseInvoice && r.Action == ApprovalAction.Create).Select(r => r.RecordId).ToHashSet();
        var deliveries = (await invoices.GetForOrderAsync(order.Id, cancellationToken))
            .Where(i => i.Status != PurchaseInvoiceStatus.Draft || pending.Contains(i.Id))
            .OrderBy(i => i.PostedAtUtc ?? i.CreatedAtUtc)
            .Select(i => new PurchaseOrderDelivery(
                i.Id, i.SupplierInvoiceNumber, i.InvoiceDate, i.Status, i.Total, i.PostedAtUtc, i.PostedBy, i.AttachmentFileName,
                order.ClosedByInvoiceId == i.Id, pending.Contains(i.Id)))
            .ToList();
        return new PurchaseOrderDto(
            order.Id, order.PoNumber, order.SupplierId, supplier?.Name ?? "A removed supplier", supplier?.Phone, order.OrderDate, order.ExpectedDeliveryDate,
            order.PaymentTerms, order.Notes, order.Status, order.CreatedBy, order.CreatedAtUtc, order.ApprovedBy, order.ApprovedAtUtc, order.CancelledBy,
            order.CancelledAtUtc, order.ClosedBy, order.ClosedAtUtc, order.ExpectedTotal, order.RemainingValue, ReceivedPercent(order),
            order.Lines.Select(l =>
            {
                var material = byId.GetValueOrDefault(l.RawMaterialId);
                return new PurchaseOrderLineDto(
                    l.Id, l.RawMaterialId, material?.Code, material?.Name ?? "A removed material", material?.PurchaseUnit ?? "unit",
                    material?.PurchaseUnitSize ?? 1, material?.Unit ?? UnitOfMeasure.Piece, l.OrderedPurchaseQty, l.ReceivedPurchaseQty, l.RemainingQty,
                    l.ExpectedUnitCost, l.LineTotal, l.LineNotes);
            }).ToList(),
            deliveries);
    }

    public static decimal ReceivedPercent(PurchaseOrder order) =>
        order.ExpectedTotal > 0
            ? Math.Round((order.ExpectedTotal - order.RemainingValue) * 100 / order.ExpectedTotal, 1, MidpointRounding.AwayFromZero)
            : order.Lines.All(l => l.RemainingQty == 0) ? 100 : 0;
}

// What a purchase order has received, counted from the posted invoices that name it; and an
// invoice set against its order (ThreeWayMatch), as it is posted and for a manager to sign off.
internal sealed class PurchaseOrderReceiver(
    IPurchaseOrderRepository orders,
    IPurchaseInvoiceRepository invoices,
    IRawMaterialRepository materials,
    ISupplierRepository suppliers)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // The order an invoice delivers, if it names one: from the same supplier.
    public async Task<PurchaseOrder?> OrderOfAsync(PurchaseInvoice invoice, CancellationToken cancellationToken)
    {
        if (invoice.PurchaseOrderId is not { } id)
            return null;
        var order = await orders.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("Purchase order", id);
        if (order.SupplierId != invoice.SupplierId)
            throw new DomainException($"{order.PoNumber} is ordered from another supplier: choose its supplier, or another order. · أمر الشراء لمورد آخر.");
        return order;
    }

    // Open for a delivery: approved, and not complete or cancelled. A correction of an invoice
    // already against it is received whatever it stands at.
    public static void EnsureReceivable(PurchaseOrder order, PurchaseInvoice invoice)
    {
        if (invoice.RevisionOf is null && !order.IsOpen)
            throw new DomainException(order.Status == PurchaseOrderStatus.Draft
                ? $"{order.PoNumber} is not approved yet: a manager approves it before it is received. · أمر الشراء غير معتمد."
                : $"{order.PoNumber} is {PurchaseOrder.StatusName(order.Status)}: nothing more is received against it. · أمر الشراء مغلق.");
    }

    // What the invoice brings of each material, in purchase units, at what it cost net.
    public async Task<IReadOnlyList<DeliveredItem>> DeliveredAsync(PurchaseInvoice invoice, CancellationToken cancellationToken)
    {
        var stock = invoice.Lines.Where(l => l.ItemType == PurchaseItemType.Inventory && l.RawMaterialId is not null).ToList();
        var sizes = await SizesAsync(stock.Select(l => l.RawMaterialId!.Value), cancellationToken);
        return stock.Select(l => new DeliveredItem(l.RawMaterialId!.Value, l.Quantity / sizes.GetValueOrDefault(l.RawMaterialId!.Value, 1), l.Cost)).ToList();
    }

    public async Task<MatchResult> MatchAsync(PurchaseOrder order, PurchaseInvoice invoice, CancellationToken cancellationToken) =>
        ThreeWayMatch.Compare(order, await DeliveredAsync(invoice, cancellationToken));

    public async Task<PurchaseOrderMatchDto> MatchDtoAsync(PurchaseOrder order, PurchaseInvoice invoice, MatchResult? match, CancellationToken cancellationToken)
    {
        if (match is null)
            return new PurchaseOrderMatchDto(order.Id, order.PoNumber, order.Status, invoice.ClosesPurchaseOrder, null, 0, false, false);
        var named = (await materials.GetByIdsAsync(match.Lines.Select(l => l.RawMaterialId), cancellationToken)).ToDictionary(m => m.Id);
        return new PurchaseOrderMatchDto(
            order.Id, order.PoNumber, order.Status, invoice.ClosesPurchaseOrder,
            match.Lines.Select(l => new MatchLineDto(
                l.RawMaterialId, named.GetValueOrDefault(l.RawMaterialId)?.Name ?? "A removed material", named.GetValueOrDefault(l.RawMaterialId)?.PurchaseUnit ?? "unit",
                l.Ordered, l.Remaining, l.Received, l.ExpectedUnitCost, l.NetUnitPrice, l.UnitOvercharge, l.Overcharge, l.QtyOver, l.ShortBy, l.PriceOver,
                l.Status)).ToList(),
            match.Overcharge, match.HasShort, match.NeedsApproval);
    }

    // Posted against its order: counted in, and the order closed with what came when it says so.
    public async Task PostedAsync(PurchaseInvoice invoice, PurchaseOrder order, string by, CancellationToken cancellationToken)
    {
        await RecountAsync(order, invoice, cancellationToken);
        if (invoice.ClosesPurchaseOrder && order.IsOpen)
            order.Close(by, invoice.Id);
    }

    // Voided: what it brought comes off its order again, which may open again.
    public async Task VoidedAsync(PurchaseInvoice invoice, CancellationToken cancellationToken)
    {
        if (invoice.PurchaseOrderId is { } id && await orders.GetByIdAsync(id, cancellationToken) is { } order)
            await RecountAsync(order, invoice, cancellationToken);
    }

    private async Task RecountAsync(PurchaseOrder order, PurchaseInvoice changed, CancellationToken cancellationToken)
    {
        // The one in hand as it is now, posted or voided in this unit of work and not saved yet.
        var posted = (await invoices.GetForOrderAsync(order.Id, cancellationToken)).Where(i => i.Id != changed.Id).Append(changed)
            .Where(i => i.Status == PurchaseInvoiceStatus.Posted)
            .ToList();
        var lines = posted.SelectMany(i => i.Lines).Where(l => l.ItemType == PurchaseItemType.Inventory && l.RawMaterialId is not null).ToList();
        var sizes = await SizesAsync(lines.Select(l => l.RawMaterialId!.Value), cancellationToken);
        var received = lines.GroupBy(l => l.RawMaterialId!.Value)
            .ToDictionary(g => g.Key, g => g.Sum(l => l.Quantity / sizes.GetValueOrDefault(g.Key, 1)));
        order.Recount(received, order.ClosedByInvoiceId is not { } closer || posted.Any(i => i.Id == closer));
    }

    // "Invoice F-1 · Nile Farms against PO-2026-0001: L.E 40.00 overcharged, 1 item over", and each
    // difference, the order against the invoice.
    public async Task<(string Summary, IReadOnlyList<ApprovalChange> Changes)> DescribeAsync(
        PurchaseOrder order, PurchaseInvoice invoice, MatchResult match, CancellationToken cancellationToken)
    {
        var supplier = (await suppliers.GetByIdAsync(order.SupplierId, cancellationToken))?.Name ?? "a supplier";
        var named = (await materials.GetByIdsAsync(match.Lines.Select(l => l.RawMaterialId), cancellationToken)).ToDictionary(m => m.Id);
        var over = match.Lines.Count(l => l.QtyOver > 0);
        var parts = new List<string>();
        if (match.Overcharge > 0)
            parts.Add($"{Money(match.Overcharge)} overcharged");
        if (over > 0)
            parts.Add($"{over} {(over == 1 ? "item" : "items")} over the order");
        var summary = $"{(invoice.SupplierInvoiceNumber is { } number ? $"Invoice {number}" : "An invoice")} · {supplier} against {order.PoNumber}: " +
                      $"{string.Join(", ", parts)} · {Money(invoice.Total)}";
        var changes = new List<ApprovalChange> { new("Purchase order · أمر الشراء", null, $"{order.PoNumber} · {supplier}") };
        foreach (var line in match.Lines.Where(l => l.PriceOver || l.QtyOver > 0))
        {
            var material = named.GetValueOrDefault(line.RawMaterialId);
            var (name, unit) = (material?.Name ?? "A removed material", material?.PurchaseUnit ?? "unit");
            if (line.Status == MatchStatus.NotOrdered)
            {
                changes.Add(new ApprovalChange($"{name} · not ordered · غير مطلوب", "Not on the order", $"{Quantity(line.Received)} {unit} came"));
                continue;
            }
            if (line.PriceOver)
                changes.Add(new ApprovalChange(
                    $"{name} · price per {unit} · زيادة سعر", $"{Money(line.ExpectedUnitCost)} on the order",
                    $"{Money(line.NetUnitPrice ?? 0)} billed · +{Money(line.UnitOvercharge ?? 0)} each, {Money(line.Overcharge)} in all"));
            if (line.QtyOver > 0)
                changes.Add(new ApprovalChange(
                    $"{name} · quantity · كمية زائدة", $"{Quantity(line.Remaining)} {unit} left to come",
                    $"{Quantity(line.Received)} {unit} came · {Quantity(line.QtyOver)} over"));
        }
        changes.Add(new ApprovalChange("Invoice total · إجمالي الفاتورة", Money(order.RemainingValue) + " left on the order", Money(invoice.Total)));
        return (summary, changes);
    }

    private async Task<IReadOnlyDictionary<Guid, decimal>> SizesAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken)
    {
        var distinct = ids.Distinct().ToList();
        return distinct.Count == 0
            ? new Dictionary<Guid, decimal>()
            : (await materials.GetByIdsAsync(distinct, cancellationToken)).ToDictionary(m => m.Id, m => m.PurchaseUnitSize > 0 ? m.PurchaseUnitSize : 1);
    }

    private static string Money(decimal value) => CompanyMoney.Text(value);

    private static string Quantity(decimal value) => value.ToString("#,##0.###", Invariant);
}

// What a posting request waiting for a manager holds: the invoice, and the order it is against.
public sealed record PostAgainstOrder(Guid InvoiceId, Guid PurchaseOrderId);

// ---- Writing them ----

public sealed record PurchaseOrderInput(
    Guid SupplierId,
    DateOnly OrderDate,
    DateOnly? ExpectedDeliveryDate,
    PurchaseOrderTerms PaymentTerms,
    string? Notes,
    IReadOnlyList<PurchaseOrderLineEntry> Lines);

// A draft written or rewritten. Id made by the till.
public sealed record SavePurchaseOrderCommand(Guid Id, PurchaseOrderInput Order, string StaffId, string StaffName)
    : IRequest<PurchaseOrderDto>, IRetryOnConflict;

// Approved: at once for a manager; asked of one for anyone else, the draft locked until then.
public sealed record ApprovePurchaseOrderCommand(Guid RequestId, Guid Id, string? Reason, string StaffId, string StaffName, bool CanApprove)
    : IRequest<PurchaseOrderSaved>, IRetryOnConflict;

// Called off before anything came: a draft by whoever wrote orders, an approved one by a manager.
public sealed record CancelPurchaseOrderCommand(Guid Id, string StaffName, bool CanApprove) : IRequest<PurchaseOrderDto>, IRetryOnConflict;

// What has not come is not expected any more: closed with what was received. A manager's.
public sealed record ClosePurchaseOrderCommand(Guid Id, string StaffName) : IRequest<PurchaseOrderDto>, IRetryOnConflict;

// Several written at once, a supplier each (from the order planner): all or none. A manager's are
// approved at once; anyone else's are drafts asked of a manager, each its own request.
public sealed record NewPurchaseOrder(Guid Id, PurchaseOrderInput Order);

public sealed record CreatePurchaseOrdersCommand(IReadOnlyList<NewPurchaseOrder> Orders, string StaffId, string StaffName, bool CanApprove)
    : IRequest<IReadOnlyList<PurchaseOrderSaved>>, IRetryOnConflict;

internal sealed class PurchaseOrderWriter(IPurchaseOrderRepository orders, ISupplierRepository suppliers, IRawMaterialRepository materials)
{
    public const int MaxAtOnce = 30;

    public async Task<PurchaseOrder> CreateAsync(Guid id, PurchaseOrderInput input, string staffId, string staffName, CancellationToken cancellationToken)
    {
        await CheckAsync(input, null, cancellationToken);
        var order = new PurchaseOrder(
            id, await orders.NextSequenceAsync(input.OrderDate.Year, cancellationToken), input.SupplierId, input.OrderDate, input.ExpectedDeliveryDate,
            input.PaymentTerms, input.Notes, input.Lines ?? [], staffId, staffName);
        orders.Add(order);
        return order;
    }

    public async Task ChangeAsync(PurchaseOrder order, PurchaseOrderInput input, CancellationToken cancellationToken)
    {
        await CheckAsync(input, order, cancellationToken);
        order.Change(input.SupplierId, input.OrderDate, input.ExpectedDeliveryDate, input.PaymentTerms, input.Notes, input.Lines ?? []);
    }

    // A supplier on the list, materials bought (not made) and not deleted: a draft keeps what it had.
    private async Task CheckAsync(PurchaseOrderInput input, PurchaseOrder? kept, CancellationToken cancellationToken)
    {
        var supplier = await suppliers.GetByIdAsync(input.SupplierId, cancellationToken)
            ?? throw new DomainException("That supplier is no longer on the list. Choose it again, or add it.");
        if (supplier.IsArchived && kept?.SupplierId != supplier.Id)
            throw new DomainException($"{supplier.Name} is archived. Restore it on the Suppliers tab to order from it again.");
        var ids = (input.Lines ?? []).Select(l => l.RawMaterialId).Distinct().ToList();
        var found = (await materials.GetByIdsAsync(ids, cancellationToken)).ToDictionary(m => m.Id);
        var had = kept?.Lines.Select(l => l.RawMaterialId).ToHashSet() ?? [];
        foreach (var id in ids)
        {
            if (found.GetValueOrDefault(id) is not { } material)
                throw new DomainException("An item on the order is no longer on the list. Choose it again.");
            if (material.IsPrepItem)
                throw new DomainException($"{material.Name} is made in the kitchen, not bought: make it with a production order.");
            if (material.IsArchived && !had.Contains(id))
                throw new DomainException($"{material.Name} has been deleted from the raw materials.");
        }
    }

    // "PO-2026-0001 · Nile Farms · 3 items · L.E 1,200.00, expected 18 Nov", and what it orders.
    public async Task<(string Summary, IReadOnlyList<ApprovalChange> Changes)> DescribeAsync(PurchaseOrder order, CancellationToken cancellationToken)
    {
        var supplier = (await suppliers.GetByIdAsync(order.SupplierId, cancellationToken))?.Name ?? "a supplier";
        var named = (await materials.GetByIdsAsync(order.Lines.Select(l => l.RawMaterialId), cancellationToken)).ToDictionary(m => m.Id);
        var summary = $"{order.PoNumber} · {supplier} · {order.Lines.Count} {(order.Lines.Count == 1 ? "item" : "items")} · {CompanyMoney.Text(order.ExpectedTotal)}" +
                      (order.ExpectedDeliveryDate is { } due ? $", expected {due.ToString("d MMM", CultureInfo.InvariantCulture)}" : "");
        var changes = new List<ApprovalChange>
        {
            new("Supplier · المورد", null, supplier),
            new("Paid · الدفع", null, order.PaymentTerms == PurchaseOrderTerms.Credit ? "On credit · آجل" : "Cash · نقدي"),
        };
        changes.AddRange(order.Lines.Select(l =>
        {
            var material = named.GetValueOrDefault(l.RawMaterialId);
            return new ApprovalChange(
                material?.Name ?? "A removed material", null,
                $"{l.OrderedPurchaseQty.ToString("#,##0.###", CultureInfo.InvariantCulture)} {material?.PurchaseUnit ?? "unit"} × {CompanyMoney.Text(l.ExpectedUnitCost)} = {CompanyMoney.Text(l.LineTotal)}");
        }));
        return (summary, changes);
    }
}

internal sealed class SavePurchaseOrderHandler(
    IPurchaseOrderRepository orders, PurchaseOrderWriter writer, PurchaseOrderReading reading, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<SavePurchaseOrderCommand, PurchaseOrderDto>
{
    public async Task<PurchaseOrderDto> Handle(SavePurchaseOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await orders.GetByIdAsync(request.Id, cancellationToken);
        if (order is null)
            order = await writer.CreateAsync(request.Id, request.Order, request.StaffId, request.StaffName, cancellationToken);
        else
        {
            await requests.EnsureNotPendingAsync(order.Id, cancellationToken);
            await writer.ChangeAsync(order, request.Order, cancellationToken);
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(order, cancellationToken);
    }
}

internal sealed class ApprovePurchaseOrderHandler(
    IPurchaseOrderRepository orders, PurchaseOrderWriter writer, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<ApprovePurchaseOrderCommand, PurchaseOrderSaved>
{
    public async Task<PurchaseOrderSaved> Handle(ApprovePurchaseOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await orders.GetRequiredAsync(request.Id, cancellationToken);
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } asked)
            return new PurchaseOrderSaved(order.Id, order.PoNumber, order.Status, asked.IsPending ? ApprovalOutcome.Requested : ApprovalOutcome.Applied,
                ApprovalRequestDto.From(asked));
        if (order.Status != PurchaseOrderStatus.Draft)
            return order.Status == PurchaseOrderStatus.Cancelled
                ? throw new DomainException($"{order.PoNumber} is cancelled.")
                : new PurchaseOrderSaved(order.Id, order.PoNumber, order.Status, ApprovalOutcome.Applied);
        await requests.EnsureNotPendingAsync(order.Id, cancellationToken);
        var saved = await PurchaseOrderApproval.ApproveOrAskAsync(order, request.RequestId, request.Reason, request.StaffId, request.StaffName, request.CanApprove,
            writer, requests, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return saved;
    }
}

internal static class PurchaseOrderApproval
{
    public static async Task<PurchaseOrderSaved> ApproveOrAskAsync(
        PurchaseOrder order, Guid requestId, string? reason, string staffId, string staffName, bool canApprove, PurchaseOrderWriter writer,
        IApprovalRequestRepository requests, CancellationToken cancellationToken)
    {
        if (canApprove)
        {
            order.Approve(staffId, staffName);
            return new PurchaseOrderSaved(order.Id, order.PoNumber, order.Status, ApprovalOutcome.Applied);
        }
        var (summary, changes) = await writer.DescribeAsync(order, cancellationToken);
        var asked = ApprovalRequest.AskToChange(
            requestId, ApprovalModule.PurchaseOrder, ApprovalAction.Create, order.Id, summary, changes, ApprovalPayload.Write(new { order.Id, order.PoNumber }),
            reason, staffId, staffName);
        requests.Add(asked);
        return new PurchaseOrderSaved(order.Id, order.PoNumber, order.Status, ApprovalOutcome.Requested, ApprovalRequestDto.From(asked));
    }
}

internal sealed class CancelPurchaseOrderHandler(
    IPurchaseOrderRepository orders, PurchaseOrderReading reading, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<CancelPurchaseOrderCommand, PurchaseOrderDto>
{
    public async Task<PurchaseOrderDto> Handle(CancelPurchaseOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await orders.GetRequiredAsync(request.Id, cancellationToken);
        if (order.Status != PurchaseOrderStatus.Cancelled)
        {
            if (order.Status != PurchaseOrderStatus.Draft && !request.CanApprove)
                throw new DomainException($"{order.PoNumber} is approved: a manager calls it off. · إلغاء أمر شراء معتمد للمدير.");
            // A request waiting to approve it is turned down with it.
            if (await requests.GetPendingForAsync(order.Id, cancellationToken) is { } pending)
                pending.Reject(request.StaffName, "Cancelled · ألغي أمر الشراء");
            order.Cancel(request.StaffName);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        return await reading.DtoAsync(order, cancellationToken);
    }
}

internal sealed class ClosePurchaseOrderHandler(IPurchaseOrderRepository orders, PurchaseOrderReading reading, IUnitOfWork unitOfWork)
    : IRequestHandler<ClosePurchaseOrderCommand, PurchaseOrderDto>
{
    public async Task<PurchaseOrderDto> Handle(ClosePurchaseOrderCommand request, CancellationToken cancellationToken)
    {
        var order = await orders.GetRequiredAsync(request.Id, cancellationToken);
        if (order.Status != PurchaseOrderStatus.Completed)
        {
            order.Close(request.StaffName);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        return await reading.DtoAsync(order, cancellationToken);
    }
}

internal sealed class CreatePurchaseOrdersHandler(
    IPurchaseOrderRepository orders, PurchaseOrderWriter writer, ISupplierRepository suppliers, IApprovalRequestRepository requests, IUnitOfWork unitOfWork)
    : IRequestHandler<CreatePurchaseOrdersCommand, IReadOnlyList<PurchaseOrderSaved>>
{
    public async Task<IReadOnlyList<PurchaseOrderSaved>> Handle(CreatePurchaseOrdersCommand request, CancellationToken cancellationToken)
    {
        if (request.Orders.Count == 0)
            throw new DomainException("Nothing to order: approve a quantity first. · لا توجد كميات معتمدة.");
        if (request.Orders.Count > PurchaseOrderWriter.MaxAtOnce)
            throw new DomainException($"Write {PurchaseOrderWriter.MaxAtOnce} purchase orders at most at once.");
        if (request.Orders.Select(o => o.Id).Distinct().Count() != request.Orders.Count)
            throw new DomainException("The same purchase order is there twice.");

        var saved = new List<PurchaseOrderSaved>();
        var problems = new List<string>();
        foreach (var entry in request.Orders)
        {
            try
            {
                // Sent again after an answer was lost: written already.
                if (await orders.GetByIdAsync(entry.Id, cancellationToken) is { } made)
                {
                    var waiting = await requests.GetPendingForAsync(made.Id, cancellationToken);
                    saved.Add(new PurchaseOrderSaved(made.Id, made.PoNumber, made.Status, waiting is null ? ApprovalOutcome.Applied : ApprovalOutcome.Requested,
                        waiting is null ? null : ApprovalRequestDto.From(waiting)));
                    continue;
                }
                var order = await writer.CreateAsync(entry.Id, entry.Order, request.StaffId, request.StaffName, cancellationToken);
                saved.Add(await PurchaseOrderApproval.ApproveOrAskAsync(
                    order, entry.Id, null, request.StaffId, request.StaffName, request.CanApprove, writer, requests, cancellationToken));
            }
            catch (Exception error) when (error is DomainException or NotFoundException)
            {
                var supplier = (await suppliers.GetByIdAsync(entry.Order.SupplierId, cancellationToken))?.Name;
                problems.Add($"{supplier ?? "A supplier"}: {error.Message}");
            }
        }
        if (problems.Count > 0)
            throw new DomainException(string.Join("\n", problems));
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return saved;
    }
}

// ---- Reading them ----

// Newest first; Open: approved or partly received, for a delivery to be received against.
public sealed record GetPurchaseOrdersQuery(PurchaseOrderStatus? Status = null, bool OpenOnly = false, Guid? SupplierId = null, DateOnly? Today = null)
    : IRequest<IReadOnlyList<PurchaseOrderSummaryDto>>;

internal sealed class GetPurchaseOrdersHandler(IPurchaseOrderRepository orders, ISupplierRepository suppliers, IPurchaseInvoiceRepository invoices)
    : IRequestHandler<GetPurchaseOrdersQuery, IReadOnlyList<PurchaseOrderSummaryDto>>
{
    public async Task<IReadOnlyList<PurchaseOrderSummaryDto>> Handle(GetPurchaseOrdersQuery request, CancellationToken cancellationToken)
    {
        var names = (await suppliers.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        var delivered = await invoices.GetDeliveriesByOrderAsync(cancellationToken);
        return (await orders.GetAllAsync(cancellationToken))
            .Where(o => (request.Status is null || o.Status == request.Status) && (!request.OpenOnly || o.IsOpen)
                && (request.SupplierId is null || o.SupplierId == request.SupplierId))
            .Select(o => new PurchaseOrderSummaryDto(
                o.Id, o.PoNumber, o.SupplierId, names.GetValueOrDefault(o.SupplierId) ?? "A removed supplier", o.OrderDate, o.ExpectedDeliveryDate,
                o.PaymentTerms, o.Status, o.Lines.Count, o.ExpectedTotal, o.RemainingValue, PurchaseOrderReading.ReceivedPercent(o),
                delivered.GetValueOrDefault(o.Id), o.CreatedBy, o.ApprovedBy,
                o.IsOpen && request.Today is { } today && o.ExpectedDeliveryDate < today))
            .ToList();
    }
}

public sealed record GetPurchaseOrderQuery(Guid Id) : IRequest<PurchaseOrderDto?>;

internal sealed class GetPurchaseOrderHandler(IPurchaseOrderRepository orders, PurchaseOrderReading reading)
    : IRequestHandler<GetPurchaseOrderQuery, PurchaseOrderDto?>
{
    public async Task<PurchaseOrderDto?> Handle(GetPurchaseOrderQuery request, CancellationToken cancellationToken) =>
        await orders.GetByIdAsync(request.Id, cancellationToken) is { } order ? await reading.DtoAsync(order, cancellationToken) : null;
}

// The open orders, in full, for a delivery to be received against: a supplier's, or everyone's.
public sealed record GetOpenPurchaseOrdersQuery(Guid? SupplierId = null) : IRequest<IReadOnlyList<PurchaseOrderDto>>;

internal sealed class GetOpenPurchaseOrdersHandler(IPurchaseOrderRepository orders, PurchaseOrderReading reading)
    : IRequestHandler<GetOpenPurchaseOrdersQuery, IReadOnlyList<PurchaseOrderDto>>
{
    public async Task<IReadOnlyList<PurchaseOrderDto>> Handle(GetOpenPurchaseOrdersQuery request, CancellationToken cancellationToken)
    {
        var open = (await orders.GetAllAsync(cancellationToken)).Where(o => o.IsOpen && (request.SupplierId is null || o.SupplierId == request.SupplierId)).ToList();
        var dtos = new List<PurchaseOrderDto>();
        foreach (var order in open)
            dtos.Add(await reading.DtoAsync(order, cancellationToken));
        return dtos;
    }
}
```


> 📄 **`backend/src/Costing.Infrastructure/Persistence/PurchaseOrderPersistence.cs`** — 72 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Suppliers;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

// Purchase orders and their lines: PO-year-sequence unique, a line per material.
internal sealed class PurchaseOrderConfiguration : IEntityTypeConfiguration<PurchaseOrder>
{
    public void Configure(EntityTypeBuilder<PurchaseOrder> builder)
    {
        builder.ToTable("PurchaseOrders", CostingDbContext.CostingSchema);
        builder.Property(o => o.PoNumber).HasMaxLength(16);
        builder.Property(o => o.PaymentTerms).IsEnumName();
        builder.Property(o => o.Status).IsEnumName();
        builder.Property(o => o.Notes).HasMaxLength(PurchaseOrder.MaxNotesLength);
        builder.Property(o => o.CreatedByUserId).HasMaxLength(450);
        builder.Property(o => o.CreatedBy).HasMaxLength(200);
        builder.Property(o => o.ApprovedByUserId).HasMaxLength(450);
        builder.Property(o => o.ApprovedBy).HasMaxLength(200);
        builder.Property(o => o.CancelledBy).HasMaxLength(200);
        builder.Property(o => o.ClosedBy).HasMaxLength(200);
        builder.Ignore(o => o.IsOpen);
        builder.Ignore(o => o.ExpectedTotal);
        builder.Ignore(o => o.RemainingValue);
        builder.HasIndex(o => o.PoNumber).IsUnique();
        builder.HasIndex(o => new { o.Year, o.Sequence }).IsUnique();
        builder.HasIndex(o => new { o.Status, o.SupplierId });
        builder.HasOne<Supplier>().WithMany().HasForeignKey(o => o.SupplierId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(o => o.Lines).WithOne().HasForeignKey(l => l.PurchaseOrderId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(o => o.Lines).HasField("_lines").UsePropertyAccessMode(PropertyAccessMode.Field).AutoInclude();
    }
}

internal sealed class PurchaseOrderLineConfiguration : IEntityTypeConfiguration<PurchaseOrderLine>
{
    public void Configure(EntityTypeBuilder<PurchaseOrderLine> builder)
    {
        builder.ToTable("PurchaseOrderLines", CostingDbContext.CostingSchema);
        builder.Property(l => l.OrderedPurchaseQty).HasPrecision(18, 3);
        builder.Property(l => l.ReceivedPurchaseQty).HasPrecision(18, 3);
        builder.Property(l => l.ExpectedUnitCost).HasPrecision(18, 4);
        builder.Property(l => l.LineNotes).HasMaxLength(PurchaseOrder.MaxLineNotesLength);
        builder.Ignore(l => l.RemainingQty);
        builder.Ignore(l => l.LineTotal);
        builder.Property(l => l.RawMaterialId).HasColumnName("MaterialId");
        builder.HasOne<RawMaterial>().WithMany().HasForeignKey(l => l.RawMaterialId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(l => new { l.PurchaseOrderId, l.RawMaterialId }).IsUnique();
    }
}

internal sealed class PurchaseOrderRepository(CostingDbContext db) : IPurchaseOrderRepository
{
    public Task<PurchaseOrder?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.PurchaseOrders.SingleOrDefaultAsync(o => o.Id == id, cancellationToken);

    public void Add(PurchaseOrder aggregate) => db.PurchaseOrders.Add(aggregate);

    public async Task<IReadOnlyList<PurchaseOrder>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.PurchaseOrders.OrderByDescending(o => o.Year).ThenByDescending(o => o.Sequence).ToListAsync(cancellationToken);

    public async Task<int> NextSequenceAsync(int year, CancellationToken cancellationToken = default)
    {
        var saved = await db.PurchaseOrders.Where(o => o.Year == year).MaxAsync(o => (int?)o.Sequence, cancellationToken) ?? 0;
        var pending = db.ChangeTracker.Entries<PurchaseOrder>()
            .Where(e => e.State == EntityState.Added && e.Entity.Year == year).Select(e => e.Entity.Sequence).DefaultIfEmpty(0).Max();
        return Math.Max(saved, pending) + 1;
    }
}
```


`PurchaseOrdersController` (`api/inventory/purchase-orders`)، و `POST api/costing/intelligence/orders/purchase-orders` يحوّل كميات مخطط الطلبيات المعتمدة إلى أمر لكل مورد.

> 📄 **`backend/src/Costing.Api/Controllers/PurchaseOrdersController.cs`** — 83 سطر

```csharp
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.Purchases;
using Costing.Domain.Access;
using Costing.Domain.Purchases;

namespace Costing.Api.Controllers;

// Purchase orders (أوامر الشراء) on Purchases: written as drafts, by hand or from the order planner a
// supplier each (batch), approved by a manager (anyone else's asked of one: 202), printed or copied
// for the supplier, and received against the supplier's invoices (an invoice names the order it
// delivers: PUT api/inventory/purchase-invoices/{id} with purchaseOrderId). Ids are made by the till.
[ApiController]
[Route("api/inventory/purchase-orders")]
[Authorize(Policy = Permissions.InventoryManage)]
public sealed class PurchaseOrdersController(ISender sender, IBusinessCalendar calendar) : ControllerBase
{
    // Newest first: by status, the open ones only, or a supplier's.
    [HttpGet]
    [CostingTab(CostingTabs.Purchases | CostingTabs.Intelligence | CostingTabs.EndOfDay)]
    public Task<IReadOnlyList<PurchaseOrderSummaryDto>> GetOrders(
        [FromQuery] PurchaseOrderStatus? status, [FromQuery] bool open, [FromQuery] Guid? supplierId, CancellationToken cancellationToken) =>
        sender.Send(new GetPurchaseOrdersQuery(status, open, supplierId, calendar.BusinessDateOf(DateTime.UtcNow)), cancellationToken);

    // The open ones in full, what is left to come of each line, for a delivery to be received against.
    [HttpGet("open")]
    [CostingTab(CostingTabs.Purchases | CostingTabs.EndOfDay)]
    public Task<IReadOnlyList<PurchaseOrderDto>> GetOpenOrders([FromQuery] Guid? supplierId, CancellationToken cancellationToken) =>
        sender.Send(new GetOpenPurchaseOrdersQuery(supplierId), cancellationToken);

    [HttpGet("{id:guid}")]
    [CostingTab(CostingTabs.Purchases)]
    public async Task<ActionResult<PurchaseOrderDto>> GetOrder(Guid id, CancellationToken cancellationToken) =>
        await sender.Send(new GetPurchaseOrderQuery(id), cancellationToken) is { } order ? order : NotFound();

    // A draft, written or rewritten.
    [HttpPut("{id:guid}")]
    [CostingTab(CostingTabs.Purchases)]
    public Task<PurchaseOrderDto> SaveOrder(Guid id, PurchaseOrderInput request, CancellationToken cancellationToken) =>
        sender.Send(new SavePurchaseOrderCommand(id, request, StaffId, StaffName), cancellationToken);

    // Approved at once for a manager (200); asked of one for anyone else (202).
    [HttpPost("{id:guid}/approve")]
    [CostingTab(CostingTabs.Purchases)]
    public async Task<IActionResult> ApproveOrder(Guid id, ApprovePurchaseOrderRequest request, CancellationToken cancellationToken)
    {
        var saved = await sender.Send(new ApprovePurchaseOrderCommand(request.RequestId, id, request.Reason, StaffId, StaffName, CanApprove), cancellationToken);
        return saved.Outcome == ApprovalOutcome.Requested ? Accepted(saved) : Ok(saved);
    }

    // Called off before anything came: a draft by whoever writes orders, an approved one by a manager.
    [HttpPost("{id:guid}/cancel")]
    [CostingTab(CostingTabs.Purchases)]
    public Task<PurchaseOrderDto> CancelOrder(Guid id, CancellationToken cancellationToken) =>
        sender.Send(new CancelPurchaseOrderCommand(id, StaffName, CanApprove), cancellationToken);

    // What has not come is not expected any more. A manager's.
    [HttpPost("{id:guid}/close")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<PurchaseOrderDto> CloseOrder(Guid id, CancellationToken cancellationToken) =>
        sender.Send(new ClosePurchaseOrderCommand(id, StaffName), cancellationToken);

    // Several at once, a supplier each, from the order planner: all or none (422, each by its supplier).
    [HttpPost("batch")]
    [CostingTab(CostingTabs.Purchases | CostingTabs.Intelligence)]
    public Task<IReadOnlyList<PurchaseOrderSaved>> CreateOrders(CreatePurchaseOrdersRequest request, CancellationToken cancellationToken) =>
        sender.Send(new CreatePurchaseOrdersCommand(request.Orders ?? [], StaffId, StaffName, CanApprove), cancellationToken);

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;

    private string StaffId => UserClaims.IdOf(User) ?? string.Empty;

    private bool CanApprove => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide);
}

public sealed record ApprovePurchaseOrderRequest(Guid RequestId, string? Reason = null);

public sealed record CreatePurchaseOrdersRequest(IReadOnlyList<NewPurchaseOrder>? Orders);
```


### 1.5 الاستلام المباشر والهالك (`StockIntake`)

`ReceivePurchaseCommand` (استلام بإذن) و `RecordSpoilageCommand` (هالك: يخرج المخزون بحركة `Spoilage` بالمتوسط). والمعرّف من المتصفح: الضغط مرتين على شبكة ضعيفة يجد الحركة نفسها ولا يكررها.

> 📄 **`backend/src/Costing.Application/RawMaterials/StockIntake.cs`** — 109 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;
using Costing.Application.Books;

namespace Costing.Application.RawMaterials;

// PurchaseId and StockCountId are generated by the client when the screen opens, not by the
// server. A cashier who taps Save twice on a flaky LAN, or a browser that retries, sends the
// same id again. The second request finds the movements already posted and changes nothing,
// so a delivery is never booked twice.

// Paid from the safe: for a manager at once, and asked of one for anyone else, as an invoice is.
public sealed record ReceivePurchaseCommand(
    Guid PurchaseId, IReadOnlyList<PurchaseLine> Lines, string RecordedBy = "", string StaffId = "", bool CanApprove = true)
    : IRequest<IReadOnlyList<RawMaterialDto>>, IRetryOnConflict, IBooksEntry
{
    bool IBooksEntry.WritesToday => true;
}

// Quantity in the material's own unit (grams, millilitres, pieces). Cost: what the line cost in
// all, from the invoice; it moves the material's average cost. Without it, only stock changes.
public sealed record PurchaseLine(Guid RawMaterialId, decimal Quantity, decimal? Cost = null);

internal sealed class ReceivePurchaseCommandHandler(
    IRawMaterialRepository materials,
    IPurchaseInvoiceRepository invoices,
    IStockMovementRepository movements,
    IPurchaseCategoryRepository categories,
    IApprovalRequestRepository requests,
    TreasuryWriter treasury,
    IUnitOfWork unitOfWork) : IRequestHandler<ReceivePurchaseCommand, IReadOnlyList<RawMaterialDto>>
{
    private static readonly IReadOnlyDictionary<UnitOfMeasure, string> UnitLabels =
        new Dictionary<UnitOfMeasure, string> { [UnitOfMeasure.Gram] = "g", [UnitOfMeasure.Millilitre] = "ml", [UnitOfMeasure.Piece] = "pc" };

    // A delivery in one request, filed as a posted invoice in the materials' own units, so the
    // invoices' history has it too. One booked before invoices were kept has movements and no
    // invoice: a retry of it changes nothing either.
    public async Task<IReadOnlyList<RawMaterialDto>> Handle(ReceivePurchaseCommand request, CancellationToken cancellationToken)
    {
        var byId = await materials.GetRequiredByIdsAsync(
            request.Lines.Select(l => l.RawMaterialId).ToList(), cancellationToken);

        if (await invoices.GetByIdAsync(request.PurchaseId, cancellationToken) is null
            && !await movements.ExistsAsync(request.PurchaseId, StockMovementReason.Purchase, cancellationToken))
        {
            var invoice = new PurchaseInvoice(request.PurchaseId, request.RecordedBy);
            invoice.Record(null, null, null, request.Lines
                .Select(l => new PurchaseInvoiceLineEntry(l.RawMaterialId, l.Quantity, UnitLabels[byId[l.RawMaterialId].Unit], 1, l.Cost))
                .ToList(), PurchasePaymentMethod.Safe);
            invoices.Add(invoice);
            foreach (var movement in invoice.Post(byId, request.RecordedBy))
                movements.Add(movement);
            await treasury.SettleAsync(invoice, Guid.NewGuid(), request.StaffId, request.RecordedBy, request.CanApprove, requests, cancellationToken);

            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return await categories.DtosAsync(byId.Values, cancellationToken);
    }
}

// Thrown-away raw stock, as a manager records it. SpoilageId works as PurchaseId does, and
// RecordedBy is set by the API from who is signed in.
public sealed record RecordSpoilageCommand(Guid SpoilageId, IReadOnlyList<SpoilageLine> Lines, string RecordedBy = "")
    : IRequest<IReadOnlyList<RawMaterialDto>>, IRetryOnConflict, IBooksEntry
{
    bool IBooksEntry.WritesToday => true;
}

// Quantity in the material's own unit. Reason: expired, spoiled, dropped, damaged packaging.
// ResponsibleStationId: the kitchen or bar station held to account for it (القسم المسؤول), the
// material's own unless another is named (the hot kitchen spoiling a shared item).
public sealed record SpoilageLine(Guid RawMaterialId, decimal Quantity, string Reason, Guid? ResponsibleStationId = null);

internal sealed class RecordSpoilageCommandHandler(
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    IPurchaseCategoryRepository categories,
    Costing.Domain.Stations.IKitchenStationRepository stations,
    IUnitOfWork unitOfWork) : IRequestHandler<RecordSpoilageCommand, IReadOnlyList<RawMaterialDto>>
{
    public async Task<IReadOnlyList<RawMaterialDto>> Handle(RecordSpoilageCommand request, CancellationToken cancellationToken)
    {
        var byId = await materials.GetRequiredByIdsAsync(
            request.Lines.Select(l => l.RawMaterialId).ToList(), cancellationToken);

        if (!await movements.ExistsAsync(request.SpoilageId, StockMovementReason.Spoilage, cancellationToken))
        {
            foreach (var station in request.Lines.Select(l => l.ResponsibleStationId).OfType<Guid>().Distinct())
                if (await stations.GetByIdAsync(station, cancellationToken) is null)
                    throw new DomainException("That station is no longer on the list: choose another. · هذا القسم غير موجود.");
            foreach (var line in request.Lines)
                movements.Add(byId[line.RawMaterialId].RecordSpoilage(
                    line.Quantity, request.SpoilageId, line.Reason, request.RecordedBy, line.ResponsibleStationId));

            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return await categories.DtosAsync(byId.Values, cancellationToken);
    }
}
```


### 1.6 الموردون

مورد له فواتير يُؤرشف (يختفي من قائمة الاختيار ويبقى على فواتيره) ويُستعاد؛ والمورد بلا فواتير يُحذف.

> 📄 **`backend/src/Costing.Application/Suppliers/Suppliers.cs`** — 133 سطر

```csharp
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Common;
using Costing.Domain.Purchases;
using Costing.Domain.Suppliers;

namespace Costing.Application.Suppliers;

// The suppliers the invoices are filed under. SupplierId is made by the till.

public sealed record SupplierDto(
    Guid Id,
    string Name,
    string? ContactPerson,
    string? Phone,
    string? Email,
    string? Notes,
    bool IsArchived,
    // Invoices it is on, drafts included: any at all and deleting it archives it instead.
    int Invoices,
    decimal PostedTotal,
    DateTime? LastPostedAtUtc,
    // Days it gives to pay a credit invoice (مدة السداد).
    int PaymentTermsDays = 0)
{
    public static SupplierDto From(Supplier supplier, SupplierUse? use) => new(
        supplier.Id, supplier.Name, supplier.ContactPerson, supplier.Phone, supplier.Email, supplier.Notes, supplier.IsArchived,
        use?.Invoices ?? 0, use?.PostedTotal ?? 0, use?.LastPostedAtUtc, supplier.PaymentTermsDays);
}

public enum SupplierRemoval
{
    Deleted = 1,

    // It is on invoices: kept for them, off the list for new ones.
    Archived = 2,
}

public sealed record SupplierRemovalDto(SupplierRemoval Outcome);

// By name. The archived ones only when asked for: the Suppliers screen shows them to restore.
public sealed record GetSuppliersQuery(bool IncludeArchived = false) : IRequest<IReadOnlyList<SupplierDto>>;

internal sealed class GetSuppliersQueryHandler(ISupplierRepository suppliers, IPurchaseInvoiceRepository invoices)
    : IRequestHandler<GetSuppliersQuery, IReadOnlyList<SupplierDto>>
{
    public async Task<IReadOnlyList<SupplierDto>> Handle(GetSuppliersQuery request, CancellationToken cancellationToken)
    {
        var use = await invoices.GetSupplierUseAsync(cancellationToken);
        return (await suppliers.GetAllAsync(cancellationToken))
            .Where(s => request.IncludeArchived || !s.IsArchived)
            .OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(s => SupplierDto.From(s, use.GetValueOrDefault(s.Id)))
            .ToList();
    }
}

// Adds the supplier, or changes its details. Two suppliers cannot share a name, archived or not:
// the invoices would not say which was which.
public sealed record SaveSupplierCommand(
    Guid SupplierId, string Name, string? ContactPerson = null, string? Phone = null, string? Email = null, string? Notes = null,
    int? PaymentTermsDays = null)
    : IRequest<SupplierDto>;

internal sealed class SaveSupplierCommandHandler(ISupplierRepository suppliers, IPurchaseInvoiceRepository invoices, IUnitOfWork unitOfWork)
    : IRequestHandler<SaveSupplierCommand, SupplierDto>
{
    public async Task<SupplierDto> Handle(SaveSupplierCommand request, CancellationToken cancellationToken)
    {
        var details = new SupplierDetails(
            request.Name ?? string.Empty, request.ContactPerson, request.Phone, request.Email, request.Notes, request.PaymentTermsDays);
        if (!string.IsNullOrWhiteSpace(details.Name)
            && await suppliers.GetByNormalizedNameAsync(Supplier.Normalize(details.Name), cancellationToken) is { } namesake
            && namesake.Id != request.SupplierId)
        {
            throw new DomainException(namesake.IsArchived
                ? $"{namesake.Name} is already a supplier, archived. Restore it from the archived suppliers."
                : $"{namesake.Name} is already a supplier.");
        }

        var supplier = await suppliers.GetByIdAsync(request.SupplierId, cancellationToken);
        if (supplier is null)
            suppliers.Add(supplier = new Supplier(request.SupplierId, details));
        else
            supplier.Update(details);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return SupplierDto.From(supplier, (await invoices.GetSupplierUseAsync(cancellationToken)).GetValueOrDefault(supplier.Id));
    }
}

// Deleted if it is on no invoice; archived if it is, so the invoices keep it.
public sealed record DeleteSupplierCommand(Guid SupplierId) : IRequest<SupplierRemovalDto>;

internal sealed class DeleteSupplierCommandHandler(ISupplierRepository suppliers, IPurchaseInvoiceRepository invoices, IUnitOfWork unitOfWork)
    : IRequestHandler<DeleteSupplierCommand, SupplierRemovalDto>
{
    public async Task<SupplierRemovalDto> Handle(DeleteSupplierCommand request, CancellationToken cancellationToken)
    {
        // Already gone: a retry of a delete that worked.
        if (await suppliers.GetByIdAsync(request.SupplierId, cancellationToken) is not { } supplier)
            return new SupplierRemovalDto(SupplierRemoval.Deleted);

        var outcome = SupplierRemoval.Deleted;
        if (await invoices.AnyForSupplierAsync(supplier.Id, cancellationToken))
        {
            supplier.Archive();
            outcome = SupplierRemoval.Archived;
        }
        else
        {
            suppliers.Remove(supplier);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new SupplierRemovalDto(outcome);
    }
}

// Back on the list new invoices pick from.
public sealed record RestoreSupplierCommand(Guid SupplierId) : IRequest<SupplierDto>;

internal sealed class RestoreSupplierCommandHandler(ISupplierRepository suppliers, IPurchaseInvoiceRepository invoices, IUnitOfWork unitOfWork)
    : IRequestHandler<RestoreSupplierCommand, SupplierDto>
{
    public async Task<SupplierDto> Handle(RestoreSupplierCommand request, CancellationToken cancellationToken)
    {
        var supplier = await suppliers.GetRequiredAsync(request.SupplierId, cancellationToken);
        supplier.Restore();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return SupplierDto.From(supplier, (await invoices.GetSupplierUseAsync(cancellationToken)).GetValueOrDefault(supplier.Id));
    }
}
```


---

## 2. تقفيل اليوم (End of the Day): شرح كامل

### 2.1 لماذا يوجد؟

في نهاية الوردية، الفرع **يسلّم** ما حدث اليوم بالأدلة: صور الفواتير، صور إيصالات الدفع، تقرير Z. والمحاسب يحوّلها لاحقًا لفواتير مرحّلة وتوريد. هذا يفصل **"من حدث عنده الشيء"** (الفرع) عن **"من يرحّله في الدفاتر"** (المحاسب)، ويترك أثرًا مصوّرًا لكل جنيه خرج من الدرج.

### 2.2 الأقسام الستة

1. **فواتير نقدية**: دُفعت من الدرج، بصورتها، مورّدها، وإجماليها المكتوب.
2. **فواتير آجلة**: بصورتها، على حساب المورد.
3. **إجمالي المشتريات**.
4. **سداد موردين من الدرج** (`EndOfDayPayout: SupplierPayment`) بإيصاله.
5. **سلف موظفين من الدرج** (`EmployeeAdvance`) بإيصال موقّع.
6. **تقرير المبيعات**: العُهدة (الفكة)، الكاش، الفيزا، الضريبة، الإلغاءات وأسبابها، وصورة Z.

### 2.3 المعادلات

```text
ضريبة الكاش        = الضريبة × حصة الكاش من (الكاش + الفيزا)       (CashTax)
الكاش المحصّل       = الكاش + ضريبة الكاش                             (CashSalesCollected)
المدفوع من الدرج   = الفواتير النقدية + سداد الموردين + سلف الموظفين   (CashPaidOut)
صافي الكاش في الدرج = العُهدة + الكاش المحصّل − المدفوع من الدرج       (NetCashInTill)
المتوقع للخزنة      = إجمالي الإيراد − المدفوع من الدرج                (ExpectedIntoSafe)
```

**الفيزا لا تدخل الدرج أبدًا**، لذلك لا تظهر في صافي الكاش. مثال: عُهدة 500، كاش 3,000، فيزا 1,000، ضريبة 560 (حصة الكاش 75% ⇐ 420)، فواتير نقدية 400، سداد مورد 300، سلفة 250:

```text
الكاش المحصّل = 3000 + 420 = 3420
المدفوع       = 400 + 300 + 250 = 950
صافي الدرج    = 500 + 3420 − 950 = 2970
المتوقع للخزنة = (3000 + 1000 + 560) − 950 = 3610
```

### 2.4 دورة الحياة

```text
Draft ──(تسليم: Review & confirm)──► Submitted ──(إلغاء التقفيل: مدير، آخر يوم فقط)──► Draft
   │                                     │
   └─ إضافة/تعديل/حذف بنود بصورها         ├─ الفواتير ⇐ تظهر في يومية المشتريات لتُنسخ وتُرحّل (مرة واحدة)
                                         ├─ المدفوعات ⇐ قيود خزنة من إيراد اليوم (Vouchered)
                                         │     مدير ⇐ فورًا؛ غيره ⇐ طلبات موافقة
                                         │     سلفة لموظف من HR والربط مفعّل ⇐ HrOutbox مع الإيصال (الفصل 07)
                                         └─ المبيعات ⇐ تملأ نافذة التوريد مسبقًا حتى يُكتب فوقها
```

- **كل إضافة بمعرّف يصنعه المتصفح مرة واحدة** ⇐ لا تكرار عند إعادة الإرسال.
- **المراجعة قبل التسليم:** لا يُسلّم يوم بفاتورة/دفعة مكتوبة ولم تُضف، ولا بلا مبيعات إلا بتأكيد أنه "يوم بدون مبيعات" (`ZeroSales`).
- الصور في `EndOfDayPhotos` بمفتاح الفاتورة/الدفعة (وصورة Z بمفتاح اليوم)، ويُتحقق من نوعها بأول بايتات وحجمها.

### 2.5 التسلسل الزمني الصارم وإلغاء تقفيل آخر يوم

**المشكلة:** لو أُقفل يوم 5 قبل يوم 4، أو أُقفل يوم في المستقبل، تختل الخزنة والمخزون والتقارير: يوم ناقص بين يومين مقفولين لا يلاحظه أحد. فالقاعدة: **الأيام تُقفل بالترتيب بالضبط**.

```text
LastClosedDate   = أحدث يوم Submitted                  (days.LastSubmittedDateAsync)
NextExpectedDate = LastClosedDate + 1                   (EndOfDaySequence.NextAfter)

EndOfDaySequence.Check(date, lastClosed, today, lockedUntil):
  date > today                     ⇐ "That day has not come yet"            (القاعدة 2)
  date ≤ BooksLockedUntilDate      ⇐ PeriodLockedException (423): "Cannot modify records before the locked period …"
  lastClosed ≠ null و date ≤ last  ⇐ "… is closed already, or before the last closed day"
  lastClosed ≠ null و date > last+1⇐ "Close {next} first: days are closed in exact order"  (القاعدة 1)
  lastClosed = null                ⇐ أي يوم حتى اليوم يبدأ التسلسل
```

- الفحص في **مكانين**: عند فتح يوم جديد (`OpenAsync`: أول بند لا يصنع يومًا خارج الدور) وعند التسليم (`CheckSequenceAsync`). اليوم الموجود سلفًا (مسودة قديمة) يُعدّل، لكن لا يُسلّم إلا في دوره.
- **يوم بلا مبيعات:** `Submit(by, zeroSales)` يرفض `NetSales ≤ 0` إلا مع `zeroSales`، والمعالج يرفضه لو لليوم ملخص مبيعات (من الـ POS أو يدوي) أو توريد في الخزنة: لا يُخفى بيعٌ حقيقي تحت "بدون مبيعات".
- **تحذيرات لا تمنع** (`WarningsAsync`): فواتير مشتريات مسودة بتاريخ ≤ اليوم، وعُهد نقدية (سلف معلقة بلا اسم) أقدم من 48 ساعة في آخر 30 يومًا. تظهر في `GET sequence` لليوم التالي وفي رد التسليم.
- **إقفال الدفاتر** (`CompanySettings.BooksLockedUntilDate`، من الإعدادات ← إقفال الدفاتر): لا تقفيل ولا تعديل ولا إلغاء ليوم ≤ تاريخ الإقفال، ولا أي حركة أخرى بتاريخه (الفصل 03). يضعه المدير حتى آخر يوم مقفول على الأكثر، ولا يتجاوز اليوم.

**إلغاء تقفيل آخر يوم** (`UndoLastEndOfDayCommand`، للمدير): آخر يوم فقط، فتبقى الأيام قبله كما هي، وبالتاريخ الذي رآه المدير (لو أُقفل يوم بعده في الأثناء يُرفض). في وحدة واحدة، بتاريخ اليوم:

```text
1. التوريد في الخزنة          ⇐ VoidAsync               (ما صُرف من إيراد اليوم قبله يعود لدرج اليوم: takingsInSafe = false)
2. ملخص المبيعات (POS/يدوي)   ⇐ deletions.DeleteAsync   (المخزون يعود)
   تقارير Z لليوم             ⇐ Forgotten() + PosDay.Undone()   (نفس التقرير لو أُعيد إرساله يُسجل من جديد، لا يُعامل كتكرار)
3. فواتير الشراء المرحلة منه  ⇐ VoidInvoiceAsync        (المخزون والتكلفة والنقدية وحساب المورد) ثم Unposted (فك الربط)
4. المدفوعات في الخزنة        ⇐ VoidAsync؛ والمنتظرة موافقة ⇐ Reject
   EndOfDayPayout.Unvouchered()⇐ VoucherId جديد، فالتسليم التالي يصنع قيدًا جديدًا
5. اليوم                      ⇐ Undo(by, reason): Draft، ويصبح هو اليوم التالي المتوقع
```

**لماذا `VoucherId` وليس معرّف الدفعة؟** قيد الخزنة كان بمعرّف الدفعة نفسه. بعد الإلغاء القيد القديم موجود (ملغى)، فإعادة التسليم كانت ستجده وتظن أنه سُجل ("أُرسل مرتين") فلا تصنع قيدًا. الحل: معرّف قيد منفصل يتجدد مع كل إلغاء، ومُلئ في الـ migration لكل الدفعات القديمة بمعرّفها (`UPDATE … SET "VoucherId" = "Id"`)، فلا يتغير شيء للبيانات السابقة.

**لماذا `takingsInSafe`؟** عكس قيد مدفوع من إيراد اليوم يُرجع المال للخزنة لو كان التوريد فيها. لكننا نلغي التوريد نفسه في نفس الوحدة، فالمال يجب أن يعود لدرج اليوم. لذلك يمرر الإلغاء `takingsInSafe: false` لكل ما يعكسه.

`GET /api/end-of-day/sequence` يعيد التسلسل ومعاينة ما سيُلغى (`EndOfDayUndoPreview`)، و `POST void-last` (وأيضًا `/api/costing/end-of-day/void-last`) ينفذ الإلغاء، و `reopen/{date}` صار نفس الإلغاء لذلك اليوم لو كان الأخير.

### 2.6 يوم مغلق، والمسودة العالقة

التسلسل الصارم يحتاج منفذين لا يكسرانه:

**يوم لم يعمل فيه المطعم** (`MarkClosedDayCommand`): صيانة أو إجازة. يُقفل **اليوم التالي المتوقع فقط** كيوم مُرسل بلا بيانات (`IsClosedDay` + `ClosedDayReason` إجباري ≤ 300 حرف)، فيصبح اليوم بعده هو التالي. يُرفض لو على اليوم أي بيانات (`HasEntries`: فاتورة، دفعة، رقم مبيعات، صورة Z)، ويُرفض لو له ملخص مبيعات أو توريد (`EnsureNothingSoldAsync`، نفس فحص "يوم بدون مبيعات"): يوم باع فيه المطعم لا يُسجَّل "مغلقًا" وإلا اختفت مبيعاته من التقفيل وبقيت في الدفاتر. الإلغاء (`Undo`) يعيده مسودة عادية.

**مسودة بتاريخ خاطئ** (`ReassignEndOfDayDateCommand`، للمدير): مسودة بتاريخ بعد اليوم التالي المتوقع لا تُسلَّم أبدًا مكانها. `GET sequence` يعدّها (`StrandedDrafts`). النقل في وحدة واحدة، والترتيب مهم:

```text
1. CheckSequence(target)        ⇐ الهدف هو اليوم التالي المتوقع فقط
2. يوم على الهدف؟               ⇐ ببيانات: رفض (لا دمج للأيام)؛ فارغ: Remove ليُفسح المكان
3. day.MoveTo(target, by, why)  ⇐ يتحقق من السبب والمسودة أولًا، ثم يكتب سطر التدقيق في الملاحظات وملاحظة كل فاتورة و AuditTrail ويغيّر Date
4. الفواتير المسودة المدفوعة من إيراد ذلك اليوم ⇐ PurchaseInvoice.MoveDay(from, to)
```

**لماذا `MoveTo` قبل الفواتير؟** في الاختبار ظهر أن محاولة مرفوضة (بلا سبب) غيّرت تاريخ الفاتورة قبل أن يُفحص السبب: EF لا يحفظها، لكن التحقق يجب أن يسبق أي تغيير. **ولماذا `AuditTrail` منفصل؟** الملاحظات يكتب فيها المستخدم ويمكنه مسح السطر؛ السجل لا يغيره أحد. وُسّعت الملاحظات (2000 لليوم، 1000 للفاتورة) لتتسع لأسطر التدقيق، وبقيت ملاحظة الدفعة 200. حذف اليوم الفارغ وتغيير تاريخ المسودة إلى نفس التاريخ (فهرس فريد على `Date`) في `SaveChanges` واحد: EF يرتب الحذف قبل التحديث، واختُبر على قاعدة حقيقية.

> 📄 **`backend/src/Costing.Application/EndOfDay/EndOfDays.cs`** — 1004 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Sales;
using Costing.Domain.Staff;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;
using Costing.Application.Books;

namespace Costing.Application.EndOfDay;

// The end of the day (تقفيل اليوم) as a branch hands it in: the day's invoices photographed, each
// paid in cash out of the takings or bought on credit, with its supplier and the total on it; the
// cash paid out of the till to suppliers and as advances to employees, each with its receipt; and
// the day's sales report with the float the drawer opened with. Filled in as a draft, an entry at a
// time so a phone sends one photo at a time; submitted, it is kept as it is for the daily batch,
// where each invoice is transcribed from its photo, and for the day's takings, and each payment and
// advance becomes the safe's entry out of the day's takings (a manager's at once, anyone else's
// asked of a manager), under the payment's voucher id. Days are closed in exact order, one after the
// last closed day and never ahead of today; a manager undoes the last closed day, and only it, to
// correct it: what it made voided and the day a draft again (Strict sequentiality and the manager's
// undo, in the docs). The day is made by its first entry; an entry's id is made by the till, so one sent again is not added twice.
//
// An advance is deducted from the employee's pay in the payroll month it is paid in, as every
// advance out of the safe is.

public sealed record EndOfDayPhotoDto(string FileName, string ContentType, int Bytes)
{
    public static EndOfDayPhotoDto? From(EndOfDayPhoto? photo) => photo is null ? null : new(photo.FileName, photo.ContentType, photo.Bytes);
}

public sealed record EndOfDayInvoiceDto(
    Guid Id,
    EndOfDayInvoiceKind Kind,
    Guid SupplierId,
    string Supplier,
    decimal ReportedTotal,
    string? Note,
    EndOfDayPhotoDto Photo,
    DateTime AddedAtUtc,
    // The purchase invoice it was posted as on the daily batch.
    Guid? PurchaseInvoiceId,
    DateTime? PostedAtUtc,
    // The purchase order it delivers, when there was one: the batch receives it against it.
    Guid? PurchaseOrderId = null);

// Where a payment's safe entry is: none yet (the day not handed in), asked of a manager, in the
// safe, or refused by a manager (it can then be taken off, and entered again).
public enum EndOfDayVoucherState
{
    None = 1,
    Requested = 2,
    InSafe = 3,
    Refused = 4,
}

public sealed record EndOfDayPayoutDto(
    Guid Id,
    EndOfDayPayoutKind Kind,
    Guid? SupplierId,
    Guid? EmployeeId,
    // The supplier's or the employee's name.
    string Payee,
    decimal Amount,
    string? Note,
    EndOfDayPhotoDto Receipt,
    DateTime AddedAtUtc,
    EndOfDayVoucherState Voucher,
    DateTime? VoucheredAtUtc);

public sealed record EndOfDayDto(
    Guid Id,
    DateOnly Date,
    EndOfDayStatus Status,
    decimal? CashAmount,
    decimal? CardAmount,
    decimal? TaxAmount,
    decimal? VoidsAmount,
    string? Notes,
    EndOfDayPhotoDto? SalesPhoto,
    IReadOnlyList<EndOfDayInvoiceDto> Invoices,
    int CashInvoices,
    decimal CashInvoicesTotal,
    int CreditInvoices,
    decimal CreditInvoicesTotal,
    // Cash and Visa before tax; with the tax; the cash once the cash invoices were paid out of it;
    // and what should reach the safe, everything less the cash invoices.
    decimal NetSales,
    decimal TotalRevenue,
    decimal CashAfterInvoices,
    decimal ExpectedIntoSafe,
    // How many of its invoices are posted on the daily batch.
    int Posted,
    // The day's takings as entered on Financials, if they are.
    decimal? TakingsEntered,
    string CreatedBy,
    DateTime CreatedAtUtc,
    string UpdatedBy,
    DateTime UpdatedAtUtc,
    string? SubmittedBy,
    DateTime? SubmittedAtUtc,
    string? ReopenedBy,
    DateTime? ReopenedAtUtc,
    // The float the drawer opened with; the cash paid out to suppliers and as advances.
    decimal? OpeningFloat,
    IReadOnlyList<EndOfDayPayoutDto> Payouts,
    int SupplierPayments,
    decimal SupplierPaymentsTotal,
    int Advances,
    decimal AdvancesTotal,
    // The tax on the cash sales (their share of the day's tax), the cash the sales put in the drawer
    // with it, all that was paid out of the drawer, and what should be left in it: the float and the
    // cash sales, less the cash invoices, the suppliers paid and the advances.
    decimal CashTax,
    decimal CashSalesCollected,
    decimal CashPaidOut,
    decimal NetCashInTill,
    // The discounts and promos the Z report gives, and why: never collected, never in the till.
    decimal? DiscountsAmount = null,
    IReadOnlyList<DiscountReason>? DiscountReasons = null,
    // Why a manager undid it, when one did.
    string? ReopenReason = null,
    // As it was handed in: what to look at before the next day (EndOfDayChecks), never refusing it.
    IReadOnlyList<string>? Warnings = null,
    // A day the restaurant did not trade, and why; what the system did to the day, a line each.
    bool IsClosedDay = false,
    string? ClosedDayReason = null,
    string? AuditTrail = null);

// The days in their order (التسلسل الزمني): the last one closed and the one to close next (none
// before the first is ever closed: any day up to today starts the sequence), today as the till
// keeps it, whether every day up to today is closed, the books' lock, what to look at before
// closing the next (Warnings), and what undoing the last one would reverse (LastClosed).
public sealed record EndOfDaySequenceDto(
    DateOnly? LastClosedDate,
    DateOnly? NextExpectedDate,
    DateOnly Today,
    bool AllClosed,
    DateOnly? BooksLockedUntil,
    IReadOnlyList<string> Warnings,
    EndOfDayUndoPreview? LastClosed,
    IReadOnlyList<EndOfDayStranded>? StrandedDrafts = null);

// A draft dated after the day to close next (مسودة عالقة): it cannot be handed in before that day
// is, so a manager moves it there with why.
public sealed record EndOfDayStranded(Guid Id, DateOnly Date, int Invoices, int Payouts, bool HasSales);

// A draft moved to the day to close next: as it is now, the date it was on, and the draft purchase
// invoices paid out of its takings that moved with it.
public sealed record EndOfDayReassigned(EndOfDayDto Day, DateOnly From, int PurchaseInvoicesMoved);

// What undoing the last closed day reverses: its takings in the safe, its sales summary (by hand
// or from the POS), the purchase invoices posted from the invoices handed in, and its payments'
// safe entries (and requests waiting for a manager). Locked: the books are closed over it.
public sealed record EndOfDayUndoPreview(
    DateOnly Date,
    string? SubmittedBy,
    DateTime? SubmittedAtUtc,
    decimal? Takings,
    int SalesItems,
    int PostedInvoices,
    decimal PostedInvoicesTotal,
    int Payouts,
    decimal PayoutsTotal,
    bool Locked,
    int ZReports = 0);

// Undone: the day back to a draft, and what was reversed to get there (ZReports: the POS's reports
// of the day, each recorded again when the POS sends it again).
public sealed record EndOfDayUndone(
    EndOfDayDto Day, bool TakingsVoided, bool SalesVoided, int InvoicesVoided, int PayoutsVoided, int RequestsRefused, int ZReports = 0);

public sealed record EndOfDayPhotoFile(string FileName, string ContentType, byte[] Content);

public sealed record GetEndOfDayQuery(DateOnly Date) : IRequest<EndOfDayDto?>;

// The days handed in over a period, latest first, without their photos.
public sealed record GetEndOfDaysQuery(DateOnly From, DateOnly To) : IRequest<IReadOnlyList<EndOfDayDto>>;

public sealed record SaveEndOfDaySalesCommand(
    DateOnly Date, decimal? CashAmount, decimal? CardAmount, decimal? TaxAmount, decimal? VoidsAmount, string? Notes, string StaffName = "",
    decimal? OpeningFloat = null, decimal? DiscountsAmount = null, IReadOnlyList<DiscountReason>? DiscountReasons = null)
    : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

public sealed record AddEndOfDayInvoiceCommand(
    DateOnly Date,
    Guid InvoiceId,
    EndOfDayInvoiceKind Kind,
    Guid SupplierId,
    decimal ReportedTotal,
    string? Note,
    string FileName,
    string ContentType,
    byte[] Content,
    string StaffName = "",
    Guid? PurchaseOrderId = null) : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

public sealed record ChangeEndOfDayInvoiceCommand(
    DateOnly Date, Guid InvoiceId, EndOfDayInvoiceKind Kind, Guid SupplierId, decimal ReportedTotal, string? Note, string StaffName = "",
    Guid? PurchaseOrderId = null)
    : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

public sealed record ReplaceEndOfDayInvoicePhotoCommand(DateOnly Date, Guid InvoiceId, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

public sealed record RemoveEndOfDayInvoiceCommand(DateOnly Date, Guid InvoiceId, string StaffName = "") : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

public sealed record AttachEndOfDaySalesPhotoCommand(DateOnly Date, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

public sealed record RemoveEndOfDaySalesPhotoCommand(DateOnly Date, string StaffName = "") : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

// Handed in: its payments and advances made the safe's entries (CanApprove, a manager), or asked of
// a manager (StaffId, who asks). Only the next day in the sequence; with no sales, only once
// confirmed as a day that sold nothing (ZeroSales) and when nothing was sold on it.
public sealed record SubmitEndOfDayCommand(DateOnly Date, string StaffName = "", string StaffId = "", bool CanApprove = false, bool ZeroSales = false)
    : IRequest<EndOfDayDto>, IRetryOnConflict, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

public sealed record GetEndOfDaySequenceQuery : IRequest<EndOfDaySequenceDto>;

// A day the restaurant did not trade (تسجيل يوم إغلاق أو صيانة): the day to close next, closed with
// nothing on it and why, so the days go on.
public sealed record MarkClosedDayCommand(DateOnly Date, string? Reason, string StaffName = "") : IRequest<EndOfDayDto>, IRetryOnConflict, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

// A manager's: a draft entered under the wrong date moved to the day to close next (TargetDate, the
// one the manager saw), with the reason, which is required and written into it.
public sealed record ReassignEndOfDayDateCommand(Guid Id, DateOnly TargetDate, string? AuditReason, string StaffName = "")
    : IRequest<EndOfDayReassigned>, IRetryOnConflict, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [TargetDate];
}

// A manager's: the last day closed, undone and back to a draft (Date: the one the manager saw, so
// a day closed since is never undone by mistake).
public sealed record UndoLastEndOfDayCommand(DateOnly? Date, string? Reason, string StaffName = "", string StaffId = "")
    : IRequest<EndOfDayUndone>, IRetryOnConflict, IChecksBooksItself;

// Cash paid out of the till: PayeeId the supplier paid or the employee advanced; PayoutId made by the
// till, so one sent again is not added twice.
public sealed record AddEndOfDayPayoutCommand(
    DateOnly Date,
    Guid PayoutId,
    EndOfDayPayoutKind Kind,
    Guid PayeeId,
    decimal Amount,
    string? Note,
    string FileName,
    string ContentType,
    byte[] Content,
    string StaffName = "") : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

public sealed record ChangeEndOfDayPayoutCommand(DateOnly Date, Guid PayoutId, Guid PayeeId, decimal Amount, string? Note, string StaffName = "")
    : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

public sealed record ReplaceEndOfDayPayoutReceiptCommand(DateOnly Date, Guid PayoutId, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

public sealed record RemoveEndOfDayPayoutCommand(DateOnly Date, Guid PayoutId, string StaffName = "") : IRequest<EndOfDayDto>, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}


// A photo of the day: an invoice's or a payment's receipt by its id, the sales report's by the day's.
public sealed record GetEndOfDayPhotoQuery(DateOnly Date, Guid PhotoId) : IRequest<EndOfDayPhotoFile?>;

// What the use cases share: the day, made by its first entry; the photo checked; the day as shown.
internal sealed class EndOfDayDays(
    IEndOfDayRepository days,
    IEndOfDayPhotoStore photos,
    ISupplierRepository suppliers,
    ISafeTransactionRepository safe,
    IBusinessCalendar calendar,
    ISupplierLedgerRepository ledger,
    IStaffMemberRepository employees,
    IApprovalRequestRepository requests,
    TreasuryWriter treasury,
    IBooksLock books,
    Costing.Domain.Purchases.IPurchaseInvoiceRepository invoices,
    ISalesReceiptRepository sales)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // Cash handed out with no one named, older than this, is said before a day is closed.
    public static readonly TimeSpan CustodyAge = TimeSpan.FromHours(48);

    public IEndOfDayPhotoStore Photos => photos;

    // Today as the till keeps it: between midnight and the hour the business day starts, the
    // calendar's day is taken too, never one later.
    public DateOnly Today
    {
        get
        {
            var now = DateTime.UtcNow;
            return new[] { calendar.BusinessDateOf(now), calendar.LocalDateOf(now) }.Max();
        }
    }

    // A new day only for the next in the sequence: entries for any other date would make a day that
    // can never be handed in.
    public async Task<EndOfDayReport> OpenAsync(DateOnly date, string by, CancellationToken cancellationToken)
    {
        if (await days.GetByDateAsync(date, cancellationToken) is { } day)
            return day;
        await CheckSequenceAsync(date, cancellationToken);
        days.Add(day = new EndOfDayReport(Guid.NewGuid(), date, by));
        return day;
    }

    // A day closed with no sales, or with no trade, only when nothing was sold on it: neither a sales
    // summary (from the POS or by hand) nor takings in the safe.
    public async Task EnsureNothingSoldAsync(DateOnly date, string instead, CancellationToken cancellationToken)
    {
        if (await sales.GetDailySummaryAsync(date, cancellationToken) is { } summary)
            throw new DomainException(
                $"The day's sales summary has {summary.Lines.Count} items sold on it: {instead}. · توجد مبيعات مسجلة لهذا اليوم: أدخل ريبورت المبيعات.");
        if (await safe.GetTakingsAsync(date, cancellationToken) is not null)
            throw new DomainException($"The day's takings are in the safe: {instead}. · توجد إيرادات مسجلة لهذا اليوم.");
    }

    public async Task CheckSequenceAsync(DateOnly date, CancellationToken cancellationToken) =>
        EndOfDaySequence.Check(date, await days.LastSubmittedDateAsync(cancellationToken), Today, await books.LockedUntilAsync(cancellationToken));

    // What to look at before closing a day, never refusing it: purchase invoices left as drafts
    // dated on or before it (post them first, or the stock and costs are short), and cash handed out
    // with no one named (a custody, سلفة معلقة) more than 48 hours ago in the last 30 days, which
    // should have been given out to the staff on HR → Advances or voided.
    public async Task<IReadOnlyList<string>> WarningsAsync(DateOnly date, CancellationToken cancellationToken)
    {
        var warnings = new List<string>();
        var names = (await suppliers.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        var drafts = (await invoices.GetByStatusAsync(Costing.Domain.Purchases.PurchaseInvoiceStatus.Draft, cancellationToken))
            .Where(i => i.InvoiceDate is { } on && on <= date && i.Lines.Count > 0)
            .OrderBy(i => i.InvoiceDate)
            .ToList();
        if (drafts.Count > 0)
            warnings.Add(
                $"There are draft invoices: {drafts.Count} draft purchase {(drafts.Count == 1 ? "invoice is" : "invoices are")} dated on or before {Day(date)} " +
                $"({string.Join(", ", drafts.Take(3).Select(i => (i.SupplierId is { } s ? names.GetValueOrDefault(s) : null) ?? "no supplier"))}" +
                $"{(drafts.Count > 3 ? ", …" : "")}). Consider posting them before closing the day. · توجد فواتير مسودة: يفضل ترحيلها قبل تقفيل اليوم.");
        var cutoff = DateTime.UtcNow - CustodyAge;
        var custodies = (await safe.GetPendingAdvancesAsync(cancellationToken))
            .Where(a => !a.IsReversal && !a.IsVoided && a.RecordedAtUtc < cutoff && a.BusinessDate >= date.AddDays(-30))
            .ToList();
        if (custodies.Count > 0)
            warnings.Add(
                $"{custodies.Count} cash {(custodies.Count == 1 ? "custody" : "custodies")} handed out with no one named more than 48 hours ago, " +
                $"{CompanyMoney.Text(-custodies.Sum(a => a.Amount))} in all (the oldest {Day(custodies.Min(a => a.BusinessDate))}): " +
                "settle them by giving them out on HR → Advances, or void them. · عُهد نقدية لم تُسوَّ منذ أكثر من 48 ساعة.");
        return warnings;
    }

    private static string Day(DateOnly day) => day.ToString("d MMM yyyy", Invariant);

    public async Task<EndOfDayReport> GetAsync(DateOnly date, CancellationToken cancellationToken) =>
        await days.GetByDateAsync(date, cancellationToken)
            ?? throw new NotFoundException("End of day", date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));

    // A supplier on the list: not one archived since, for a new or changed invoice.
    public async Task CheckSupplierAsync(Guid supplierId, CancellationToken cancellationToken)
    {
        var supplier = await suppliers.GetByIdAsync(supplierId, cancellationToken)
            ?? throw new DomainException("Choose the supplier from the list. · اختر المورد من القائمة.");
        if (supplier.IsArchived)
            throw new DomainException($"{supplier.Name} is archived: choose another supplier. · المورد مؤرشف.");
    }

    // Who a payment goes to, and how much it can be: a supplier on the list, paid no more than they
    // are owed less what the day's other payments to them, not in the safe yet, take off; an
    // employee on the staff, not one who has left.
    public async Task CheckPayeeAsync(EndOfDayReport day, EndOfDayPayoutKind kind, Guid payeeId, decimal amount, Guid payoutId, CancellationToken cancellationToken)
    {
        if (kind == EndOfDayPayoutKind.EmployeeAdvance)
        {
            var employee = await employees.GetByIdAsync(payeeId, cancellationToken)
                ?? throw new DomainException("Choose the employee from the list. · اختر الموظف من القائمة.");
            if (!employee.IsActive)
                throw new DomainException($"{employee.Name} has left: bring them back on Financials → Staff first. · الموظف غير نشط.");
            return;
        }

        await CheckSupplierAsync(payeeId, cancellationToken);
        var supplier = (await suppliers.GetByIdAsync(payeeId, cancellationToken))!;
        var others = await PendingToAsync(day, payeeId, payoutId, cancellationToken);
        var owed = await ledger.BalanceAsync(payeeId, cancellationToken) - others;
        if (Math.Round(amount, 2, MidpointRounding.AwayFromZero) > owed)
            throw new DomainException(owed > 0
                ? $"{supplier.Name} is owed {CompanyMoney.Text(owed)}{(others > 0 ? " after the day's other payments to them" : "")}: pay that much or less. · المبلغ أكبر من المستحق للمورد."
                : $"Nothing is owed to {supplier.Name}{(others > 0 ? " after the day's other payments to them" : "")}. · لا يوجد مستحق للمورد.");
    }

    // The day's payments to a supplier not in the safe yet: on the supplier's account only once they are.
    private async Task<decimal> PendingToAsync(EndOfDayReport day, Guid supplierId, Guid except, CancellationToken cancellationToken)
    {
        var pending = 0m;
        foreach (var payout in day.Payouts.Where(p => p.Kind == EndOfDayPayoutKind.SupplierPayment && p.SupplierId == supplierId && p.Id != except))
            if (await VoucherStateAsync(payout, cancellationToken) is EndOfDayVoucherState.None or EndOfDayVoucherState.Requested)
                pending += payout.Amount;
        return pending;
    }

    public async Task<EndOfDayVoucherState> VoucherStateAsync(EndOfDayPayout payout, CancellationToken cancellationToken)
    {
        if (payout.VoucheredAtUtc is null)
            return EndOfDayVoucherState.None;
        if (await safe.GetByIdAsync(payout.VoucherId, cancellationToken) is not null)
            return EndOfDayVoucherState.InSafe;
        return (await requests.GetByIdAsync(payout.VoucherId, cancellationToken))?.Status switch
        {
            ApprovalStatus.Rejected => EndOfDayVoucherState.Refused,
            ApprovalStatus.Pending => EndOfDayVoucherState.Requested,
            // Approved, entered: the entry is the safe's.
            _ => EndOfDayVoucherState.InSafe,
        };
    }

    // The day handed in: each payment and advance not in the safe yet made the safe's entry out of
    // the day's takings, dated the day, its id the payment's (a manager's), or asked of a manager
    // (anyone else's). All of them or none: one that cannot be refuses the day, naming it.
    public async Task VoucherPayoutsAsync(EndOfDayReport day, string staffId, string staffName, bool canApprove, CancellationToken cancellationToken)
    {
        var problems = new List<string>();
        // What each supplier is still owed as the day's payments to them are entered.
        var owedLeft = new Dictionary<Guid, decimal>();
        var names = (await suppliers.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        var staff = (await employees.GetAllAsync(cancellationToken)).ToDictionary(e => e.Id, e => e.Name);
        foreach (var payout in day.Payouts.Where(p => p.VoucheredAtUtc is null))
        {
            var toSupplier = payout.Kind == EndOfDayPayoutKind.SupplierPayment;
            var name = (toSupplier ? names.GetValueOrDefault(payout.PayeeId) : staff.GetValueOrDefault(payout.PayeeId)) ?? (toSupplier ? "a supplier" : "an employee");
            try
            {
                // Sent again after an answer was lost: entered, or asked, already.
                if (await safe.GetByIdAsync(payout.VoucherId, cancellationToken) is not null || await requests.GetByIdAsync(payout.VoucherId, cancellationToken) is not null)
                {
                    day.Vouchered(payout.Id);
                    continue;
                }

                if (toSupplier)
                {
                    var owed = owedLeft.TryGetValue(payout.PayeeId, out var left)
                        ? left
                        : await ledger.BalanceAsync(payout.PayeeId, cancellationToken) - await RequestedToAsync(day, payout.PayeeId, cancellationToken);
                    if (payout.Amount > owed)
                        throw new DomainException(owed > 0 ? $"{name} is owed {CompanyMoney.Text(owed)}: pay that much or less." : $"Nothing is owed to {name}.");
                    owedLeft[payout.PayeeId] = owed - payout.Amount;
                }

                var voucher = new SafeVoucher(
                    payout.VoucherId, toSupplier ? SafeTransactionKind.SupplierPayment : SafeTransactionKind.EmployeeAdvance, payout.Amount, day.Date,
                    RevenueDate: day.Date, SupplierId: toSupplier ? payout.PayeeId : null, EmployeeId: toSupplier ? null : payout.PayeeId,
                    Notes: payout.Note is { } note ? $"End of day: {note}" : "End of day · تقفيل اليوم");
                if (canApprove)
                {
                    await treasury.ApplyAsync(voucher, staffName, null, cancellationToken);
                }
                else
                {
                    await treasury.CheckAsync(voucher, cancellationToken);
                    var (summary, changes) = await treasury.DescribeAsync(voucher, cancellationToken);
                    requests.Add(ApprovalRequest.AskToChange(
                        payout.VoucherId, ApprovalModule.Treasury, ApprovalAction.Create, payout.VoucherId, summary, changes, ApprovalPayload.Write(voucher),
                        $"End of day of {day.Date.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}", staffId, staffName));
                }
                day.Vouchered(payout.Id);
            }
            catch (Exception error) when (error is DomainException or NotFoundException)
            {
                problems.Add($"{(toSupplier ? "Supplier payment" : "Advance")} · {name}: {error.Message}");
            }
        }
        if (problems.Count > 0)
            throw new DomainException(string.Join("\n", problems));
    }

    // The day's payments to a supplier asked of a manager and not decided yet: not on the supplier's
    // account, but promised out of what is owed.
    private async Task<decimal> RequestedToAsync(EndOfDayReport day, Guid supplierId, CancellationToken cancellationToken)
    {
        var requested = 0m;
        foreach (var payout in day.Payouts.Where(p => p.Kind == EndOfDayPayoutKind.SupplierPayment && p.SupplierId == supplierId && p.VoucheredAtUtc is not null))
            if (await VoucherStateAsync(payout, cancellationToken) == EndOfDayVoucherState.Requested)
                requested += payout.Amount;
        return requested;
    }

    public static EndOfDayPhoto Photo(string fileName, string contentType, byte[] content)
    {
        var photo = EndOfDayPhoto.Of(fileName, contentType, content.Length);
        if (!UploadedFile.LooksLike(contentType, content))
            throw new DomainException("That file is not the photo or PDF it says it is. · الملف ليس صورة أو PDF.");
        return photo;
    }

    public async Task<EndOfDayDto> DtoAsync(EndOfDayReport day, CancellationToken cancellationToken) =>
        (await DtosAsync([day], cancellationToken)).Single();

    public async Task<IReadOnlyList<EndOfDayDto>> DtosAsync(IReadOnlyList<EndOfDayReport> list, CancellationToken cancellationToken)
    {
        var names = (await suppliers.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        var staff = (await employees.GetAllAsync(cancellationToken)).ToDictionary(e => e.Id, e => e.Name);
        var dtos = new List<EndOfDayDto>();
        foreach (var day in list)
        {
            var takings = await safe.GetTakingsAsync(day.Date, cancellationToken);
            var payouts = new List<EndOfDayPayoutDto>();
            foreach (var p in day.Payouts)
            {
                var payee = p.Kind == EndOfDayPayoutKind.SupplierPayment
                    ? names.GetValueOrDefault(p.PayeeId, "A removed supplier")
                    : staff.GetValueOrDefault(p.PayeeId, "A removed employee");
                payouts.Add(new EndOfDayPayoutDto(
                    p.Id, p.Kind, p.SupplierId, p.EmployeeId, payee, p.Amount, p.Note, EndOfDayPhotoDto.From(p.Receipt)!, p.AddedAtUtc,
                    await VoucherStateAsync(p, cancellationToken), p.VoucheredAtUtc));
            }
            dtos.Add(new EndOfDayDto(
                day.Id, day.Date, day.Status, day.CashAmount, day.CardAmount, day.TaxAmount, day.VoidsAmount, day.Notes,
                EndOfDayPhotoDto.From(day.SalesPhoto),
                day.Invoices.Select(i => new EndOfDayInvoiceDto(
                    i.Id, i.Kind, i.SupplierId, names.GetValueOrDefault(i.SupplierId, "A removed supplier"), i.ReportedTotal, i.Note,
                    EndOfDayPhotoDto.From(i.Photo)!, i.AddedAtUtc, i.PurchaseInvoiceId, i.PostedAtUtc, i.PurchaseOrderId)).ToList(),
                day.CountOf(EndOfDayInvoiceKind.Cash), day.TotalOf(EndOfDayInvoiceKind.Cash),
                day.CountOf(EndOfDayInvoiceKind.Credit), day.TotalOf(EndOfDayInvoiceKind.Credit),
                day.NetSales, day.TotalRevenue, day.CashAfterInvoices, day.ExpectedIntoSafe,
                day.Invoices.Count(i => i.PurchaseInvoiceId is not null), takings?.TakingsTotal,
                day.CreatedBy, day.CreatedAtUtc, day.UpdatedBy, day.UpdatedAtUtc, day.SubmittedBy, day.SubmittedAtUtc, day.ReopenedBy, day.ReopenedAtUtc,
                day.OpeningFloat, payouts,
                day.CountOf(EndOfDayPayoutKind.SupplierPayment), day.TotalOf(EndOfDayPayoutKind.SupplierPayment),
                day.CountOf(EndOfDayPayoutKind.EmployeeAdvance), day.TotalOf(EndOfDayPayoutKind.EmployeeAdvance),
                day.CashTax, day.CashSalesCollected, day.CashPaidOut, day.NetCashInTill, day.DiscountsAmount, day.DiscountReasons.ToList(),
                day.ReopenReason, null, day.IsClosedDay, day.ClosedDayReason, day.AuditTrail));
        }
        return dtos;
    }
}

internal sealed class GetEndOfDayQueryHandler(IEndOfDayRepository days, EndOfDayDays shared) : IRequestHandler<GetEndOfDayQuery, EndOfDayDto?>
{
    public async Task<EndOfDayDto?> Handle(GetEndOfDayQuery request, CancellationToken cancellationToken) =>
        await days.GetByDateAsync(request.Date, cancellationToken) is { } day ? await shared.DtoAsync(day, cancellationToken) : null;
}

internal sealed class GetEndOfDaysQueryHandler(IEndOfDayRepository days, EndOfDayDays shared) : IRequestHandler<GetEndOfDaysQuery, IReadOnlyList<EndOfDayDto>>
{
    public async Task<IReadOnlyList<EndOfDayDto>> Handle(GetEndOfDaysQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (request.To.DayNumber - request.From.DayNumber > 92)
            throw new DomainException("Choose three months at most. · ثلاثة أشهر على الأكثر.");
        var list = (await days.GetBetweenAsync(request.From, request.To, cancellationToken)).OrderByDescending(d => d.Date).ToList();
        return await shared.DtosAsync(list, cancellationToken);
    }
}

internal sealed class SaveEndOfDaySalesCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<SaveEndOfDaySalesCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(SaveEndOfDaySalesCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        day.RecordSales(
            request.CashAmount, request.CardAmount, request.TaxAmount, request.VoidsAmount, request.Notes, request.StaffName, request.OpeningFloat,
            request.DiscountsAmount, request.DiscountReasons);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class AddEndOfDayInvoiceCommandHandler(EndOfDayDays shared, IEndOfDayRepository days, IUnitOfWork unitOfWork)
    : IRequestHandler<AddEndOfDayInvoiceCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(AddEndOfDayInvoiceCommand request, CancellationToken cancellationToken)
    {
        // Sent again after an answer was lost: added already.
        if (await days.GetByInvoiceAsync(request.InvoiceId, cancellationToken) is { } added)
            return added.Date == request.Date
                ? await shared.DtoAsync(added, cancellationToken)
                : throw new DomainException("This invoice is handed in on another day. · الفاتورة مسجلة في يوم آخر.");

        var photo = EndOfDayDays.Photo(request.FileName, request.ContentType, request.Content);
        await shared.CheckSupplierAsync(request.SupplierId, cancellationToken);
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        day.AddInvoice(request.InvoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, photo, request.StaffName, request.PurchaseOrderId);
        shared.Photos.Put(request.InvoiceId, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class ChangeEndOfDayInvoiceCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<ChangeEndOfDayInvoiceCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(ChangeEndOfDayInvoiceCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        if (day.Invoice(request.InvoiceId).SupplierId != request.SupplierId)
            await shared.CheckSupplierAsync(request.SupplierId, cancellationToken);
        day.ChangeInvoice(request.InvoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, request.StaffName, request.PurchaseOrderId);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class ReplaceEndOfDayInvoicePhotoCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork)
    : IRequestHandler<ReplaceEndOfDayInvoicePhotoCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(ReplaceEndOfDayInvoicePhotoCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        day.ReplaceInvoicePhoto(request.InvoiceId, EndOfDayDays.Photo(request.FileName, request.ContentType, request.Content), request.StaffName);
        shared.Photos.Put(request.InvoiceId, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class RemoveEndOfDayInvoiceCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<RemoveEndOfDayInvoiceCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(RemoveEndOfDayInvoiceCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        day.RemoveInvoice(request.InvoiceId, request.StaffName);
        shared.Photos.Remove(request.InvoiceId);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class AttachEndOfDaySalesPhotoCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork)
    : IRequestHandler<AttachEndOfDaySalesPhotoCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(AttachEndOfDaySalesPhotoCommand request, CancellationToken cancellationToken)
    {
        var photo = EndOfDayDays.Photo(request.FileName, request.ContentType, request.Content);
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        day.AttachSalesPhoto(photo, request.StaffName);
        shared.Photos.Put(day.Id, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class RemoveEndOfDaySalesPhotoCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork)
    : IRequestHandler<RemoveEndOfDaySalesPhotoCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(RemoveEndOfDaySalesPhotoCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        day.RemoveSalesPhoto(request.StaffName);
        shared.Photos.Remove(day.Id);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class SubmitEndOfDayCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork)
    : IRequestHandler<SubmitEndOfDayCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(SubmitEndOfDayCommand request, CancellationToken cancellationToken)
    {
        // A day that sold nothing may have nothing handed in at all: made here to be closed.
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        // Sent again after an answer was lost: submitted already.
        if (day.IsSubmitted)
            return await shared.DtoAsync(day, cancellationToken);

        // Only the next day in the sequence, never one to come or in the books locked.
        await shared.CheckSequenceAsync(day.Date, cancellationToken);
        // Closed as a day that sold nothing only when nothing was.
        if (day.NetSales <= 0 && request.ZeroSales)
            await shared.EnsureNothingSoldAsync(day.Date, "enter the day's sales report instead of closing it with none", cancellationToken);
        var warnings = await shared.WarningsAsync(day.Date, cancellationToken);
        day.Submit(request.StaffName, request.ZeroSales);
        await shared.VoucherPayoutsAsync(day, request.StaffId, request.StaffName, request.CanApprove, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken) with { Warnings = warnings };
    }
}

internal sealed class GetEndOfDaySequenceHandler(
    EndOfDayDays shared, IEndOfDayRepository days, IBooksLock books, ISafeTransactionRepository safe, ISalesReceiptRepository sales,
    Costing.Domain.Integrations.IPosZReportRepository zReports)
    : IRequestHandler<GetEndOfDaySequenceQuery, EndOfDaySequenceDto>
{
    public async Task<EndOfDaySequenceDto> Handle(GetEndOfDaySequenceQuery request, CancellationToken cancellationToken)
    {
        var last = await days.LastSubmittedDateAsync(cancellationToken);
        var next = EndOfDaySequence.NextAfter(last);
        var today = shared.Today;
        var locked = await books.LockedUntilAsync(cancellationToken);
        EndOfDayUndoPreview? preview = null;
        if (last is { } lastDate && await days.GetByDateAsync(lastDate, cancellationToken) is { } day)
        {
            var summary = await sales.GetDailySummaryAsync(lastDate, cancellationToken);
            var vouchered = day.Payouts.Where(p => p.VoucheredAtUtc is not null).ToList();
            preview = new EndOfDayUndoPreview(
                lastDate, day.SubmittedBy, day.SubmittedAtUtc, (await safe.GetTakingsAsync(lastDate, cancellationToken))?.TakingsTotal,
                summary?.Lines.Count ?? 0, day.Invoices.Count(i => i.PurchaseInvoiceId is not null),
                day.Invoices.Where(i => i.PurchaseInvoiceId is not null).Sum(i => i.ReportedTotal), vouchered.Count, vouchered.Sum(p => p.Amount),
                locked is { } l && lastDate <= l, (await zReports.GetByDateAsync(lastDate, cancellationToken)).Count);
        }
        var closing = next ?? today;
        // Drafts past the day to close next with something on them, which cannot be handed in where they
        // are; an empty one (made by a multi-day sales import) waits for its turn.
        var stranded = next is { } expected
            ? (await days.GetDraftsAfterAsync(expected, cancellationToken))
                .Where(d => d.HasEntries || d.Notes is not null)
                .Select(d => new EndOfDayStranded(d.Id, d.Date, d.Invoices.Count, d.Payouts.Count, d.NetSales > 0))
                .ToList()
            : [];
        return new EndOfDaySequenceDto(
            last, next, today, next > today, locked, next > today ? [] : await shared.WarningsAsync(closing, cancellationToken), preview, stranded);
    }
}

// A day the restaurant did not trade (تسجيل يوم إغلاق أو صيانة): the day to close next, never one to
// come or in the books locked, closed with nothing on it and why, so the next day can be closed. Its
// draft is closed when it has nothing on it; one with entries is handed in with them. Never a day
// something was sold on: its sales summary or takings say the restaurant traded.
internal sealed class MarkClosedDayCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<MarkClosedDayCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(MarkClosedDayCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        // Sent again after an answer was lost: closed already.
        if (day is { IsSubmitted: true, IsClosedDay: true })
            return await shared.DtoAsync(day, cancellationToken);
        await shared.CheckSequenceAsync(day.Date, cancellationToken);
        await shared.EnsureNothingSoldAsync(day.Date, "hand the day in with its sales instead of closing it as a day with no trade", cancellationToken);
        var warnings = await shared.WarningsAsync(day.Date, cancellationToken);
        day.MarkClosed(request.StaffName, request.Reason);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken) with { Warnings = warnings };
    }
}

// A manager's: a draft entered under the wrong date (ترحيل المسودة العالقة) moved to the day to close
// next, everything on it with it: its invoices, payments, sales report and photos. The draft purchase
// invoices paid out of its day's takings move with it (their takings' day, and their date when it was
// the day's). The reason is required and written into the day's notes, each invoice's note and the
// day's audit trail. Never onto a day with entries of its own (days are not merged): an empty draft
// there is taken away.
internal sealed class ReassignEndOfDayDateCommandHandler(
    EndOfDayDays shared,
    IEndOfDayRepository days,
    Costing.Domain.Purchases.IPurchaseInvoiceRepository invoices,
    IApprovalRequestRepository requests,
    IUnitOfWork unitOfWork) : IRequestHandler<ReassignEndOfDayDateCommand, EndOfDayReassigned>
{
    public async Task<EndOfDayReassigned> Handle(ReassignEndOfDayDateCommand request, CancellationToken cancellationToken)
    {
        var day = await days.GetByIdAsync(request.Id, cancellationToken) ?? throw new NotFoundException("End of day", request.Id);
        var (from, to) = (day.Date, request.TargetDate);
        // Sent again after an answer was lost: moved there already.
        if (from == to && !day.IsSubmitted
            && day.AuditTrail?.Contains($" to {to.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)} by ", StringComparison.Ordinal) == true)
            return new EndOfDayReassigned(await shared.DtoAsync(day, cancellationToken), from, 0);
        await shared.CheckSequenceAsync(to, cancellationToken);

        if (await days.GetByDateAsync(to, cancellationToken) is { } there && there.Id != day.Id)
        {
            if (there.IsSubmitted || there.HasEntries || there.Notes is not null)
                throw new DomainException(
                    $"{to.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture)} has entries of its own: hand them in, or take them off, before moving another day onto it. " +
                    "· لهذا اليوم بيانات مسجلة: لا تُدمج الأيام.");
            days.Remove(there);
        }

        // The day first: its reason and that it is a draft checked before anything else moves.
        day.MoveTo(to, request.StaffName, request.AuditReason);

        var moved = 0;
        // The draft invoices paid out of the day's takings (its drawer): the drawer is the new day's.
        foreach (var invoice in (await invoices.GetByStatusAsync(Costing.Domain.Purchases.PurchaseInvoiceStatus.Draft, cancellationToken))
            .Where(i => i.PaymentMethod == Costing.Domain.Purchases.PurchasePaymentMethod.DayRevenue && i.RevenueDate == from))
        {
            await requests.EnsureNotPendingAsync(invoice.Id, cancellationToken);
            var tracked = await invoices.GetByIdAsync(invoice.Id, cancellationToken) ?? invoice;
            if (tracked.MoveDay(from, to))
                moved++;
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new EndOfDayReassigned(await shared.DtoAsync(day, cancellationToken), from, moved);
    }
}

// The last closed day undone (إلغاء تقفيل آخر يوم), a manager's: everything it put in the books
// reversed, dated today, so it is handed in again as it should have been. Its takings voided in the
// safe; its sales summary (entered by hand, or made by the POS's Z report: sent again, it is made
// again) voided, its stock put back; the purchase invoices posted from the invoices handed in
// voided (their stock, costs, cash and supplier's account undone) and unlinked, to be posted again;
// its payments' safe entries voided and those still waiting for a manager refused. Only the last
// day, so the days before it stay as they were; never one in the books locked.
internal sealed class UndoLastEndOfDayHandler(
    EndOfDayDays shared,
    IEndOfDayRepository days,
    IBooksLock books,
    ISafeTransactionRepository safe,
    ISalesReceiptRepository sales,
    Costing.Domain.Purchases.IPurchaseInvoiceRepository invoices,
    IApprovalRequestRepository requests,
    Costing.Domain.StockMovements.IStockMovementRepository movements,
    DeletionTargets deletions,
    TreasuryWriter treasury,
    Costing.Domain.Integrations.IPosZReportRepository zReports,
    Costing.Domain.Integrations.IPosDayRepository posDays,
    IUnitOfWork unitOfWork) : IRequestHandler<UndoLastEndOfDayCommand, EndOfDayUndone>
{
    public async Task<EndOfDayUndone> Handle(UndoLastEndOfDayCommand request, CancellationToken cancellationToken)
    {
        var last = await days.LastSubmittedDateAsync(cancellationToken)
            ?? throw new DomainException("No day is closed: there is nothing to undo. · لا يوجد يوم مُقفل.");
        if (request.Date is { } asked && asked != last)
            throw new DomainException(
                $"Only the last closed day, {last.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}, is undone: the days before it stay as they are. " +
                "· يُلغى تقفيل آخر يوم فقط.");
        if (await books.LockedUntilAsync(cancellationToken) is { } locked && last <= locked)
            throw new PeriodLockedException(locked, last);
        var day = await shared.GetAsync(last, cancellationToken);
        var by = request.StaffName;

        // Its takings in the safe, and its sales summary with the stock it took. What was paid out of
        // the day's takings before they went in goes back to the day's drawer, not the safe: the
        // takings leave the safe less it.
        var takings = await safe.GetTakingsAsync(last, cancellationToken);
        bool? inSafe = takings is null ? null : false;
        if (takings is not null)
        {
            await requests.EnsureNotPendingAsync(takings.Id, cancellationToken);
            await treasury.VoidAsync(takings, by, cancellationToken);
        }
        var summary = await sales.GetDailySummaryAsync(last, cancellationToken);
        if (summary is not null)
        {
            await requests.EnsureNotPendingAsync(summary.Id, cancellationToken);
            foreach (var reversal in await deletions.DeleteAsync(Costing.Domain.Approvals.ApprovalModule.Sale, summary.Id, by, cancellationToken))
                movements.Add(reversal);
        }

        // The POS's mapping of the day: nothing of it recorded now, and each of its Z reports taken
        // again when the POS sends it again (the same report is not a resend any more).
        var reports = await zReports.GetByDateAsync(last, cancellationToken);
        foreach (var report in reports)
            report.Forgotten();
        (await posDays.GetByDateAsync(last, cancellationToken))?.Undone();

        // The purchase invoices posted from its invoices: the one standing now, a correction's if
        // one was corrected since, voided.
        var invoicesVoided = 0;
        foreach (var handedIn in day.Invoices.Where(i => i.PurchaseInvoiceId is not null))
        {
            var invoice = await invoices.GetByIdAsync(handedIn.PurchaseInvoiceId!.Value, cancellationToken);
            while (invoice is { Status: Costing.Domain.Purchases.PurchaseInvoiceStatus.Voided, ReplacedBy: { } next })
                invoice = await invoices.GetByIdAsync(next, cancellationToken);
            if (invoice is not { Status: Costing.Domain.Purchases.PurchaseInvoiceStatus.Posted })
                continue;
            await requests.EnsureNotPendingAsync(invoice.Id, cancellationToken);
            foreach (var reversal in await deletions.VoidInvoiceAsync(invoice, by, null, cancellationToken, inSafe))
                movements.Add(reversal);
            invoicesVoided++;
        }

        // Its payments: those in the safe voided, those waiting for a manager refused.
        var (payoutsVoided, refused) = (0, 0);
        foreach (var payout in day.Payouts.Where(p => p.VoucheredAtUtc is not null))
        {
            if (await safe.GetByIdAsync(payout.VoucherId, cancellationToken) is { IsVoided: false, IsReversal: false } entry)
            {
                await treasury.VoidAsync(entry, by, cancellationToken, inSafe);
                payoutsVoided++;
            }
            else if (await requests.GetByIdAsync(payout.VoucherId, cancellationToken) is { IsPending: true } waiting)
            {
                waiting.Reject(by, "The end of day was undone · أُلغي تقفيل اليوم");
                refused++;
            }
        }

        day.Undo(by, request.Reason);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new EndOfDayUndone(
            await shared.DtoAsync(day, cancellationToken), takings is not null, summary is not null, invoicesVoided, payoutsVoided, refused, reports.Count);
    }
}

internal sealed class AddEndOfDayPayoutCommandHandler(EndOfDayDays shared, IEndOfDayRepository days, IUnitOfWork unitOfWork)
    : IRequestHandler<AddEndOfDayPayoutCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(AddEndOfDayPayoutCommand request, CancellationToken cancellationToken)
    {
        // Sent again after an answer was lost: added already.
        if (await days.GetByPayoutAsync(request.PayoutId, cancellationToken) is { } added)
            return added.Date == request.Date
                ? await shared.DtoAsync(added, cancellationToken)
                : throw new DomainException("This payment is handed in on another day. · مسجل في يوم آخر.");

        var receipt = EndOfDayDays.Photo(request.FileName, request.ContentType, request.Content);
        var day = await shared.OpenAsync(request.Date, request.StaffName, cancellationToken);
        await shared.CheckPayeeAsync(day, request.Kind, request.PayeeId, request.Amount, request.PayoutId, cancellationToken);
        day.AddPayout(request.PayoutId, request.Kind, request.PayeeId, request.Amount, request.Note, receipt, request.StaffName);
        shared.Photos.Put(request.PayoutId, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class ChangeEndOfDayPayoutCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<ChangeEndOfDayPayoutCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(ChangeEndOfDayPayoutCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        var payout = day.Payout(request.PayoutId);
        await shared.CheckPayeeAsync(day, payout.Kind, request.PayeeId, request.Amount, payout.Id, cancellationToken);
        day.ChangePayout(request.PayoutId, request.PayeeId, request.Amount, request.Note, request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class ReplaceEndOfDayPayoutReceiptCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork)
    : IRequestHandler<ReplaceEndOfDayPayoutReceiptCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(ReplaceEndOfDayPayoutReceiptCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        day.ReplacePayoutReceipt(request.PayoutId, EndOfDayDays.Photo(request.FileName, request.ContentType, request.Content), request.StaffName);
        shared.Photos.Put(request.PayoutId, request.Content);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}

internal sealed class RemoveEndOfDayPayoutCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<RemoveEndOfDayPayoutCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(RemoveEndOfDayPayoutCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        var refused = await shared.VoucherStateAsync(day.Payout(request.PayoutId), cancellationToken) == EndOfDayVoucherState.Refused;
        day.RemovePayout(request.PayoutId, request.StaffName, refused);
        shared.Photos.Remove(request.PayoutId);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await shared.DtoAsync(day, cancellationToken);
    }
}


internal sealed class GetEndOfDayPhotoQueryHandler(IEndOfDayRepository days, IEndOfDayPhotoStore photos)
    : IRequestHandler<GetEndOfDayPhotoQuery, EndOfDayPhotoFile?>
{
    public async Task<EndOfDayPhotoFile?> Handle(GetEndOfDayPhotoQuery request, CancellationToken cancellationToken)
    {
        if (await days.GetByDateAsync(request.Date, cancellationToken) is not { } day)
            return null;
        var photo = request.PhotoId == day.Id
            ? day.SalesPhoto
            : day.Invoices.FirstOrDefault(i => i.Id == request.PhotoId)?.Photo ?? day.Payouts.FirstOrDefault(p => p.Id == request.PhotoId)?.Receipt;
        return photo is not null && await photos.GetAsync(request.PhotoId, cancellationToken) is { } content
            ? new EndOfDayPhotoFile(photo.FileName, photo.ContentType, content)
            : null;
    }
}
```


`EndOfDayController`: `multipart/form-data` لإضافة البنود بصورها، و `GET {date}` يعيد 204 إن لم يوجد يوم، والقراءة لأقسام عدة (`Readers`) والتعديل لقسم تقفيل اليوم، و `GET sequence` للقراء، وإلغاء آخر يوم (`void-last`) بصلاحية القرار. وفي `FinancialsController`: `PUT books-lock` للمدير.

> 📄 **`backend/src/Costing.Api/Controllers/EndOfDayController.cs`** — 296 سطر

```csharp
using System.Globalization;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.EndOfDay;
using Costing.Domain.Access;
using Costing.Domain.EndOfDay;
using Costing.Domain.Purchases;

namespace Costing.Api.Controllers;

// The end of the day (تقفيل اليوم): the day's invoices handed in with their photos, cash and on
// credit; the cash paid out of the till to suppliers and as advances to employees, each with its
// receipt; and its sales report with the opening float, filled in by whoever works the End of day
// section (a branch can work it alone) and submitted. Whoever works Purchases or Financials reads it
// too: the daily batch makes an invoice of each, the takings come from its sales. Submitted, each
// payment and advance becomes the safe's entry out of the day's takings: at once for a manager,
// asked of one for anyone else. Days are closed in exact order (GET sequence says which is next); a
// manager undoes the last closed one (POST void-last). Dates are the business day's, yyyy-MM-dd.
[ApiController]
[Route("api/end-of-day")]
[Authorize(Policy = Permissions.InventoryManage)]
public sealed class EndOfDayController(ISender sender) : ControllerBase
{
    private const CostingTabs Readers = CostingTabs.EndOfDay | CostingTabs.Purchases | CostingTabs.Financials;
    private const long UploadLimit = PurchaseInvoice.MaxAttachmentBytes + 64 * 1024;

    // The days of a period, latest first.
    [HttpGet]
    [CostingTab(Readers)]
    public Task<IReadOnlyList<EndOfDayDto>> GetDays([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        sender.Send(new GetEndOfDaysQuery(from, to), cancellationToken);

    // The days in their order: the last closed, the next to close, what to look at before closing it,
    // and what undoing the last would reverse.
    [HttpGet("sequence")]
    [CostingTab(Readers)]
    public Task<EndOfDaySequenceDto> GetSequence(CancellationToken cancellationToken) =>
        sender.Send(new GetEndOfDaySequenceQuery(), cancellationToken);

    // The day, or nothing (204) before anything is handed in for it.
    [HttpGet("{date}")]
    [CostingTab(Readers)]
    public async Task<ActionResult<EndOfDayDto?>> GetDay(DateOnly date, CancellationToken cancellationToken) =>
        await sender.Send(new GetEndOfDayQuery(date), cancellationToken);

    [HttpPut("{date}/sales")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> SaveSales(DateOnly date, EndOfDaySalesRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveEndOfDaySalesCommand(
            date, request.CashAmount, request.CardAmount, request.TaxAmount, request.VoidsAmount, request.Notes, StaffName, request.OpeningFloat,
            request.DiscountsAmount, request.DiscountReasons), cancellationToken);

    // An invoice handed in, with its photo: a form of invoiceId (made by the till), kind (Cash or
    // Credit), supplierId, reportedTotal, note and file.
    [HttpPost("{date}/invoices")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public async Task<ActionResult<EndOfDayDto>> AddInvoice(DateOnly date, [FromForm] EndOfDayInvoiceForm form, CancellationToken cancellationToken)
    {
        if (form.File is not { } file)
            return Refused("Photograph the invoice or attach its file. · صوّر الفاتورة أو أرفق ملفها.");
        if (!Guid.TryParse(form.InvoiceId, out var invoiceId) || !Guid.TryParse(form.SupplierId, out var supplierId))
            return Refused("Choose the supplier. · اختر المورد.");
        if (!Enum.TryParse<EndOfDayInvoiceKind>(form.Kind, true, out var kind) || !Enum.IsDefined(kind))
            return Refused("Say whether it was paid in cash or is on credit. · نقدي أم آجل.");
        if (!decimal.TryParse(form.ReportedTotal, NumberStyles.Number, CultureInfo.InvariantCulture, out var total))
            return Refused("Enter the invoice's total. · أدخل إجمالي الفاتورة.");
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return Refused("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        Guid? orderId = Guid.TryParse(form.PurchaseOrderId, out var order) ? order : null;
        return await sender.Send(new AddEndOfDayInvoiceCommand(
            date, invoiceId, kind, supplierId, total, form.Note, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName, orderId),
            cancellationToken);
    }

    [HttpPut("{date}/invoices/{invoiceId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> ChangeInvoice(DateOnly date, Guid invoiceId, EndOfDayInvoiceRequest request, CancellationToken cancellationToken) =>
        sender.Send(new ChangeEndOfDayInvoiceCommand(
            date, invoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, StaffName, request.PurchaseOrderId), cancellationToken);

    [HttpPut("{date}/invoices/{invoiceId:guid}/photo")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public async Task<ActionResult<EndOfDayDto>> ReplaceInvoicePhoto(DateOnly date, Guid invoiceId, IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return Refused("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        return await sender.Send(new ReplaceEndOfDayInvoicePhotoCommand(
            date, invoiceId, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName), cancellationToken);
    }

    [HttpDelete("{date}/invoices/{invoiceId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> RemoveInvoice(DateOnly date, Guid invoiceId, CancellationToken cancellationToken) =>
        sender.Send(new RemoveEndOfDayInvoiceCommand(date, invoiceId, StaffName), cancellationToken);

    // Cash paid to a supplier out of the till, with its receipt (إيصال السداد / إذن الصرف): a form of
    // id (made by the till), supplierId, amount, note and file.
    [HttpPost("{date}/supplier-payments")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public Task<ActionResult<EndOfDayDto>> AddSupplierPayment(DateOnly date, [FromForm] EndOfDayPayoutForm form, CancellationToken cancellationToken) =>
        AddPayout(date, EndOfDayPayoutKind.SupplierPayment, form.Id, form.SupplierId, form, cancellationToken);

    // An advance to an employee out of the till, with its signed receipt (إيصال صرف السلفة): a form
    // of id (made by the till), employeeId, amount, note and file.
    [HttpPost("{date}/advances")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public Task<ActionResult<EndOfDayDto>> AddAdvance(DateOnly date, [FromForm] EndOfDayPayoutForm form, CancellationToken cancellationToken) =>
        AddPayout(date, EndOfDayPayoutKind.EmployeeAdvance, form.Id, form.EmployeeId, form, cancellationToken);

    [HttpPut("{date}/supplier-payments/{payoutId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> ChangeSupplierPayment(DateOnly date, Guid payoutId, EndOfDayPayoutRequest request, CancellationToken cancellationToken) =>
        sender.Send(new ChangeEndOfDayPayoutCommand(date, payoutId, request.SupplierId ?? Guid.Empty, request.Amount, request.Note, StaffName), cancellationToken);

    [HttpPut("{date}/advances/{payoutId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> ChangeAdvance(DateOnly date, Guid payoutId, EndOfDayPayoutRequest request, CancellationToken cancellationToken) =>
        sender.Send(new ChangeEndOfDayPayoutCommand(date, payoutId, request.EmployeeId ?? Guid.Empty, request.Amount, request.Note, StaffName), cancellationToken);

    [HttpPut("{date}/supplier-payments/{payoutId:guid}/receipt")]
    [HttpPut("{date}/advances/{payoutId:guid}/receipt")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public async Task<ActionResult<EndOfDayDto>> ReplacePayoutReceipt(DateOnly date, Guid payoutId, IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return Refused("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        return await sender.Send(new ReplaceEndOfDayPayoutReceiptCommand(
            date, payoutId, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName), cancellationToken);
    }

    [HttpDelete("{date}/supplier-payments/{payoutId:guid}")]
    [HttpDelete("{date}/advances/{payoutId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> RemovePayout(DateOnly date, Guid payoutId, CancellationToken cancellationToken) =>
        sender.Send(new RemoveEndOfDayPayoutCommand(date, payoutId, StaffName), cancellationToken);

    // The Z report's photo.
    [HttpPut("{date}/sales-photo")]
    [CostingTab(CostingTabs.EndOfDay)]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public async Task<ActionResult<EndOfDayDto>> AttachSalesPhoto(DateOnly date, IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return Refused("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        return await sender.Send(new AttachEndOfDaySalesPhotoCommand(
            date, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName), cancellationToken);
    }

    [HttpDelete("{date}/sales-photo")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> RemoveSalesPhoto(DateOnly date, CancellationToken cancellationToken) =>
        sender.Send(new RemoveEndOfDaySalesPhotoCommand(date, StaffName), cancellationToken);

    // Only the next day in order (422 otherwise); with no sales, only as a day that sold nothing
    // (zeroSales). The answer says what to look at before the next day (warnings).
    [HttpPost("{date}/submit")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> Submit(DateOnly date, [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] SubmitEndOfDayRequest? request, CancellationToken cancellationToken) =>
        sender.Send(new SubmitEndOfDayCommand(date, StaffName, StaffId, CanApprove, request?.ZeroSales ?? false), cancellationToken);

    // The last closed day undone (إلغاء تقفيل آخر يوم), a manager's: its takings, sales summary, the
    // purchase invoices posted from it and its payments' safe entries reversed, the day a draft to
    // hand in again. Date: the one the manager saw (refused if another was closed since).
    [HttpPost("void-last")]
    [HttpPost("/api/costing/end-of-day/void-last")]
    [CostingTab(Readers)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<EndOfDayUndone> VoidLast(VoidLastEndOfDayRequest request, CancellationToken cancellationToken) =>
        sender.Send(new UndoLastEndOfDayCommand(request.Date, request.Reason, StaffName, StaffId), cancellationToken);

    // A day the restaurant did not trade (تسجيل يوم إغلاق أو صيانة): the day to close next, closed with
    // nothing on it and why (required), so the next one can be closed.
    [HttpPost("mark-closed-day")]
    [HttpPost("/api/costing/end-of-day/mark-closed-day")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> MarkClosedDay(MarkClosedDayRequest request, CancellationToken cancellationToken) =>
        sender.Send(new MarkClosedDayCommand(request.TargetDate, request.Reason, StaffName), cancellationToken);

    // A manager's: a draft entered under the wrong date moved to the day to close next (targetDate),
    // with the reason (auditReason, required), written into its notes and audit trail.
    [HttpPost("{id:guid}/reassign-date")]
    [HttpPost("/api/costing/end-of-day/{id:guid}/reassign-date")]
    [CostingTab(CostingTabs.EndOfDay)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<EndOfDayReassigned> ReassignDate(Guid id, ReassignEndOfDayDateRequest request, CancellationToken cancellationToken) =>
        sender.Send(new ReassignEndOfDayDateCommand(id, request.TargetDate, request.AuditReason, StaffName), cancellationToken);

    // Reopening a day is undoing it: only the last closed one.
    [HttpPost("{date}/reopen")]
    [CostingTab(Readers)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public async Task<EndOfDayDto> Reopen(DateOnly date, CancellationToken cancellationToken) =>
        (await sender.Send(new UndoLastEndOfDayCommand(date, null, StaffName, StaffId), cancellationToken)).Day;

    // An invoice's photo or a payment's receipt by its id, the Z report's by the day's.
    [HttpGet("{date}/photos/{photoId:guid}")]
    [CostingTab(Readers)]
    public async Task<IActionResult> GetPhoto(DateOnly date, Guid photoId, [FromQuery] bool download, CancellationToken cancellationToken)
    {
        if (await sender.Send(new GetEndOfDayPhotoQuery(date, photoId), cancellationToken) is not { } photo)
            return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        return download ? File(photo.Content, photo.ContentType, photo.FileName) : File(photo.Content, photo.ContentType);
    }

    private async Task<ActionResult<EndOfDayDto>> AddPayout(
        DateOnly date, EndOfDayPayoutKind kind, string? id, string? payee, EndOfDayPayoutForm form, CancellationToken cancellationToken)
    {
        var toSupplier = kind == EndOfDayPayoutKind.SupplierPayment;
        if (form.File is not { } file)
            return Refused(toSupplier
                ? "Photograph the payment receipt or attach its file. · صوّر إيصال السداد أو أرفق ملفه."
                : "Photograph the signed advance receipt or attach its file. · صوّر إيصال صرف السلفة أو أرفق ملفه.");
        if (!Guid.TryParse(id, out var payoutId))
            return Refused("The payment has no id: send it again from the page.");
        if (!Guid.TryParse(payee, out var payeeId))
            return Refused(toSupplier ? "Choose the supplier. · اختر المورد." : "Choose the employee. · اختر الموظف.");
        if (!decimal.TryParse(form.Amount, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount))
            return Refused("Enter the amount paid. · أدخل المبلغ المدفوع.");
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return Refused("The file must be under 10 MB. · الملف أقل من 10 ميجا.");
        return await sender.Send(new AddEndOfDayPayoutCommand(
            date, payoutId, kind, payeeId, amount, form.Note, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName), cancellationToken);
    }

    private UnprocessableEntityObjectResult Refused(string message) => UnprocessableEntity(new { errors = new[] { message } });

    private static async Task<byte[]> ContentOf(IFormFile file, CancellationToken cancellationToken)
    {
        using var content = new MemoryStream();
        await file.CopyToAsync(content, cancellationToken);
        return content.ToArray();
    }

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;

    private string StaffId => UserClaims.IdOf(User) ?? string.Empty;

    // A manager's safe entries are entered at once; anyone else's are asked of a manager.
    private bool CanApprove => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide);
}

public sealed record EndOfDaySalesRequest(
    decimal? CashAmount, decimal? CardAmount, decimal? TaxAmount, decimal? VoidsAmount, string? Notes, decimal? OpeningFloat = null,
    decimal? DiscountsAmount = null, IReadOnlyList<Costing.Domain.Sales.DiscountReason>? DiscountReasons = null);

// A payment changed: the supplier paid (a supplier payment's) or the employee advanced (an advance's).
public sealed record EndOfDayPayoutRequest(Guid? SupplierId, Guid? EmployeeId, decimal Amount, string? Note);

// As the till sends it, text: the amount is read with a point for its decimals, whatever the server's language.
public sealed class EndOfDayPayoutForm
{
    public string? Id { get; set; }
    public string? SupplierId { get; set; }
    public string? EmployeeId { get; set; }
    public string? Amount { get; set; }
    public string? Note { get; set; }
    public IFormFile? File { get; set; }
}

public sealed record SubmitEndOfDayRequest(bool ZeroSales = false);

public sealed record MarkClosedDayRequest(DateOnly TargetDate, string? Reason);

public sealed record ReassignEndOfDayDateRequest(DateOnly TargetDate, string? AuditReason);

public sealed record VoidLastEndOfDayRequest(DateOnly? Date = null, string? Reason = null);

public sealed record EndOfDayInvoiceRequest(EndOfDayInvoiceKind Kind, Guid SupplierId, decimal ReportedTotal, string? Note, Guid? PurchaseOrderId = null);

// As the till sends it, text: the total is read with a point for its decimals, whatever the server's language.
public sealed class EndOfDayInvoiceForm
{
    public string? InvoiceId { get; set; }
    public string? Kind { get; set; }
    public string? SupplierId { get; set; }
    public string? ReportedTotal { get; set; }
    public string? Note { get; set; }
    public IFormFile? File { get; set; }

    // The purchase order it delivers, if any.
    public string? PurchaseOrderId { get; set; }
}
```


---

## 3. المبيعات وملخص المبيعات اليومي

### 3.1 المحاسبة

المبيعات هنا **كميات لا فلوس**: "بيع اليوم 40 بيتزا مارجريتا كبيرة". كل سطر يخصم مخزونه **بالوصفة** (`StockRequirements`) بحركة `Sale` بالمتوسط وقتها، ويدخل التقرير النظري. والمال (الإيراد) يأتي من **التوريد** في الخزنة، لا من المبيعات.

### 3.2 الملخص اليومي (`DailySales.cs`)

ملخص واحد لكل يوم (`SalesSource.DailySummary`) كما يعطيه تقرير Z: الصنف (أو حجمه بكوده `6101-2`) والكمية. يُدخل يدويًا أو من شيت المبيعات (الفصل 07؛ وعدة أيام بملف واحد في 3.3) أو يأتي من الـ POS (الفصل 07). ملخص ثانٍ لنفس اليوم يُرفض (ألغِ الأول ثم أدخل). الأسطر تُقيَّم بأسعار المنيو للمطابقة (الفصل 06).

> 📄 **`backend/src/Costing.Application/Sales/DailySales.cs`** — 223 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Domain.Common;
using Costing.Domain.Menu;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Application.Books;

namespace Costing.Application.Sales;

// The day's sales summary (ملخص المبيعات اليومية), as a Z report gives it: each item sold that day
// and how many, no bills and no money. Recorded, each takes its stock by its recipe, and the day
// counts in the theoretical cost and the variance, its items valued at the menu's prices. The
// day's money is its takings, entered on Financials.
//
// One summary a day: entered by hand, item by item, or imported from the day's sheet (an item and
// a quantity a row). A second for a day already entered is refused, naming it: void it on Sales,
// which puts its stock back, and enter the day again.

public sealed record DailySaleLine(int MenuItemId, int? VariantId, int Quantity);

public sealed record RecordDailySalesCommand(Guid Id, DateOnly Date, IReadOnlyList<DailySaleLine> Lines, string StaffName)
    : IRequest<SalesReceiptDto>, IRetryOnConflict, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

// A row of the sales sheet: its day (the Date column; the day chosen on a one-day import), the item,
// by its code or name (or chosen from the list), and how many sold; or a discount given that day
// (الخصومات): how much, why, and on how many bills. A row may carry both.
public sealed record DailySaleRow(
    int Row, string? Item, decimal? Quantity, DateOnly? Date = null, decimal? DiscountAmount = null, string? DiscountReason = null,
    decimal? DiscountCount = null)
{
    public bool HasItem => !string.IsNullOrWhiteSpace(Item) || Quantity is not null;
    public bool HasDiscount => DiscountAmount is not null || !string.IsNullOrWhiteSpace(DiscountReason);
}

// SaleId: the day's summary recorded, or none when no row could be read.
public sealed record DailySalesImportResult(
    DateOnly Date, Guid? SaleId, int Items, int Quantity, decimal Value, IReadOnlyList<SkippedSheetRow> Skipped, decimal Discounts = 0);

public sealed record ImportDailySalesCommand(DateOnly Date, IReadOnlyList<DailySaleRow> Rows, string StaffName)
    : IRequest<DailySalesImportResult>, IRetryOnConflict, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

// The menu as the day's sheet lists it: every item, each size of one sold by size, by its code.
public sealed record DailySalesSheet(IReadOnlyList<string> Items);

public sealed record GetDailySalesSheetQuery : IRequest<DailySalesSheet>;

internal sealed class DailySalesWriter(ISalesReceiptRepository sales, SaleWriter writer, IBusinessCalendar calendar)
{
    public async Task<SalesReceipt> RecordAsync(
        Guid id, DateOnly date, IReadOnlyList<DailySaleLine> lines, string by, SaleWriter.Menu? menu, CancellationToken cancellationToken,
        decimal discounts = 0, IReadOnlyList<DiscountReason>? discountReasons = null)
    {
        var now = DateTime.UtcNow;
        var latest = new[] { calendar.BusinessDateOf(now), calendar.LocalDateOf(now) }.Max();
        if (date > latest)
            throw new DomainException("That day has not come yet: enter a day's sales once it is over. · هذا اليوم لم يأتِ بعد.");
        if (lines.Count == 0)
            throw new DomainException("Add at least one item sold. · أضف صنفًا مباعًا واحدًا على الأقل.");
        if (lines.Any(l => l.Quantity <= 0))
            throw new DomainException("Each item sold is 1 or more. · الكمية المباعة 1 أو أكثر.");
        if (await sales.GetDailySummaryAsync(date, cancellationToken) is { } entered)
            throw new DomainException(
                $"The sales of {date.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} are entered already " +
                $"({entered.Lines.Count} {(entered.Lines.Count == 1 ? "item" : "items")}, {entered.Lines.Sum(l => l.Quantity)} sold): " +
                "void them on Sales and enter the day again. · مبيعات هذا اليوم مسجلة بالفعل: ألغها من المبيعات ثم أدخل اليوم من جديد.");

        // An item twice is one line of both.
        var merged = lines
            .GroupBy(l => (l.MenuItemId, l.VariantId))
            .Select(g => new SaleLineInput(g.Key.MenuItemId, g.Key.VariantId, g.Sum(l => l.Quantity)))
            .ToList();
        return await writer.RecordAsync(
            new SaleInput(id, null, date, null, SalesChannel.DineIn, PaymentMethod.Cash, merged, DiscountAmount: discounts,
                Notes: "Daily sales summary", DiscountReasons: discountReasons),
            SalesSource.DailySummary, by, menu, cancellationToken);
    }
}

internal sealed class RecordDailySalesHandler(ISalesReceiptRepository sales, DailySalesWriter writer, IUnitOfWork unitOfWork)
    : IRequestHandler<RecordDailySalesCommand, SalesReceiptDto>
{
    public async Task<SalesReceiptDto> Handle(RecordDailySalesCommand request, CancellationToken cancellationToken)
    {
        // Sent again after a lost answer: recorded already.
        if (await sales.GetByIdAsync(request.Id, cancellationToken) is { } already)
            return SalesReceiptDto.From(already);
        var receipt = await writer.RecordAsync(request.Id, request.Date, request.Lines ?? [], request.StaffName, null, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return SalesReceiptDto.From(receipt);
    }
}

internal sealed class GetDailySalesSheetHandler(IMenuRepository menu) : IRequestHandler<GetDailySalesSheetQuery, DailySalesSheet>
{
    public async Task<DailySalesSheet> Handle(GetDailySalesSheetQuery request, CancellationToken cancellationToken) =>
        new(DailySalesItems.Of(await menu.GetItemsAsync(cancellationToken)).Labels.ToList());
}

internal static class DailySalesItems
{
    // Items and their sizes, no add-ons: an add-on is sold on an item, not by itself.
    public static MenuTargets Of(IReadOnlyList<MenuItem> items) => new(items, []);
}

internal sealed class ImportDailySalesHandler(IMenuRepository menu, DailySalesWriter writer, IUnitOfWork unitOfWork)
    : IRequestHandler<ImportDailySalesCommand, DailySalesImportResult>
{
    public const int MaxRows = 5_000;

    public async Task<DailySalesImportResult> Handle(ImportDailySalesCommand request, CancellationToken cancellationToken)
    {
        if (request.Rows.Count == 0)
            throw new DomainException("The sheet has no items on it. · الملف لا يحتوي على أصناف.");
        if (request.Rows.Count > MaxRows)
            throw new DomainException($"Import {MaxRows:N0} rows at most at a time. · {MaxRows:N0} صف على الأكثر.");

        // A sheet of several days is a multi-day upload, kept in their order: never one day of all of them.
        var others = request.Rows.Select(r => r.Date).OfType<DateOnly>().Where(d => d != request.Date).Distinct().Order().ToList();
        if (others.Count > 0)
            throw new DomainException(
                $"The sheet has sales of other days ({string.Join(", ", others.Take(5).Select(DailySheet.Day))}{(others.Count > 5 ? ", …" : "")}): " +
                "upload it as a multi-day sheet, or keep only this day's rows. · الملف يحتوي على أيام أخرى: ارفعه كملف متعدد الأيام.");

        var known = await SaleWriter.Menu.LoadAsync(menu, cancellationToken);
        var sheet = DailySheet.Read(request.Rows, DailySalesItems.Of(known.Items.Values.ToList()), known);
        if (sheet.Lines.Count == 0)
            return new DailySalesImportResult(request.Date, null, 0, 0, 0, sheet.Skipped);
        if (sheet.Problem(request.Date) is { } problem)
            throw new DomainException(problem);

        var receipt = await writer.RecordAsync(
            Guid.NewGuid(), request.Date, sheet.Lines, request.StaffName, known, cancellationToken, sheet.Discounts, sheet.Reasons);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new DailySalesImportResult(
            request.Date, receipt.Id, receipt.Lines.Count, receipt.Lines.Sum(l => l.Quantity), receipt.BilledSubtotal, sheet.Skipped, receipt.DiscountAmount);
    }
}

// A day's rows of the sales sheet read: its items sold (each row an item and how many), what was left
// out and why, and its discounts (each reason's amount and bills, added up), valued at the menu's prices.
internal sealed record DailySheet(
    IReadOnlyList<DailySaleLine> Lines, IReadOnlyList<SkippedSheetRow> Skipped, decimal Discounts, IReadOnlyList<DiscountReason> Reasons, decimal Value)
{
    public int Quantity => Lines.Sum(l => l.Quantity);

    public int Items => Lines.Select(l => (l.MenuItemId, l.VariantId)).Distinct().Count();

    public static string Day(DateOnly day) => day.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    // What stops the day being recorded: discounts more than its items come to at the menu's prices.
    public string? Problem(DateOnly date) =>
        Discounts > Value
            ? $"The discounts of {Day(date)} ({Discounts.ToString("N2", CultureInfo.InvariantCulture)}) are more than its items come to at the menu's prices " +
              $"({Value.ToString("N2", CultureInfo.InvariantCulture)}): check them. · الخصومات أكبر من قيمة المبيعات بأسعار المنيو."
            : null;

    public static DailySheet Read(IEnumerable<DailySaleRow> rows, MenuTargets targets, SaleWriter.Menu known)
    {
        var skipped = new List<SkippedSheetRow>();
        var lines = new List<DailySaleLine>();
        var given = new List<DiscountReason>();
        foreach (var row in rows)
        {
            if (row.HasItem || !row.HasDiscount)
            {
                var (line, reason, reasonAr) = Parse(row, targets, known);
                if (line is not null)
                    lines.Add(line);
                else
                    skipped.Add(new SkippedSheetRow(row.Row, row.Item, reason!, reasonAr));
            }
            if (!row.HasDiscount)
                continue;
            if (row.DiscountAmount is not { } amount || amount < 0)
                skipped.Add(new SkippedSheetRow(row.Row, row.DiscountReason, "A discount is an amount, 0 or more.", "الخصم مبلغ صفر أو أكثر."));
            else if (row.DiscountCount is { } count && (count < 0 || count != decimal.Truncate(count)))
                skipped.Add(new SkippedSheetRow(row.Row, row.DiscountReason, "The bills discounted are a whole number.", "عدد الفواتير رقم صحيح."));
            else
                given.Add(new DiscountReason(SheetText.Clean(row.DiscountReason) ?? "Not given", amount, (int)(row.DiscountCount ?? 0)));
        }
        var discounts = Math.Round(given.Sum(r => r.Amount), 2, MidpointRounding.AwayFromZero);
        var reasons = given
            .GroupBy(r => r.Reason, StringComparer.OrdinalIgnoreCase)
            .Select(g => new DiscountReason(g.First().Reason, g.Sum(r => r.Amount), g.Sum(r => r.Count)))
            .Where(r => r.Amount > 0)
            .ToList();
        var value = lines.Count == 0
            ? 0
            : SaleWriter.ValueOf(lines.Select(l => new SaleLineInput(l.MenuItemId, l.VariantId, l.Quantity)), known);
        return new DailySheet(lines, skipped, discounts, reasons, value);
    }

    // A row's item and how many sold: the item on the menu (a size of one sold by size), a whole number.
    private static (DailySaleLine? Line, string? Reason, string? ReasonAr) Parse(DailySaleRow row, MenuTargets targets, SaleWriter.Menu known)
    {
        var text = SheetText.Clean(row.Item);
        if (text is null)
            return (null, "No item: choose it from the list.", "لا يوجد صنف: اختره من القائمة.");
        if (row.Quantity is not { } quantity || quantity < 1 || quantity != decimal.Truncate(quantity) || quantity > int.MaxValue)
            return (null, "The quantity sold is a whole number, 1 or more.", "الكمية المباعة رقم صحيح 1 أو أكثر.");

        var (target, reason, reasonAr) = targets.Find(text);
        if (target is not { } found)
            return (null, reason ?? $"There is no {text} on the menu: choose the item from the list, or add it on Menu first.",
                reasonAr ?? $"لا يوجد {text} في المنيو: اختر الصنف من القائمة أو أضفه في المنيو أولًا.");
        if (found.Kind != RecipeTargetKind.MenuItem)
            return (null, "An add-on is sold on an item, not by itself: leave it out.", "الإضافة تُباع مع صنف وليست وحدها.");
        var item = known.Items[found.CatalogItemId];
        if (found.VariantId is null && item.Variants.Count > 0)
            return (null, $"{item.Name} is sold by size: choose its size from the list.", $"{item.Name} يُباع بالحجم: اختر الحجم من القائمة.");
        return (new DailySaleLine(found.CatalogItemId, found.VariantId, (int)quantity), null, null);
    }
}
```


### 3.3 استيراد عدة أيام بملف واحد (`BulkDailySales.cs`)

الشيت صار بعمود **تاريخ** في أوله، وأعمدة اختيارية للخصومات (المبلغ، السبب، عدد الفواتير) في صفوف خاصة. `DailySheet.Read` يقرأ صفوف يوم واحد: الأصناف (والمرفوض بسببه) والخصومات مجمّعة بالسبب، وقيمتها بأسعار المنيو. استيراد اليوم الواحد يرفض شيتًا فيه أيام أخرى.

`BulkSalesPlanner.PlanAsync` (للمعاينة وللتسجيل معًا):

```text
1. كل صف له تاريخ          ⇐ وإلا يُرفض الملف بأرقام الصفوف
2. تجميع بالتاريخ تصاعديًا   ⇐ 31 يومًا و 20,000 صف على الأكثر
3. كل يوم: صنف مقروء واحد على الأقل، والخصومات ≤ القيمة
4. التسلسل:
   تاريخ > اليوم              ⇐ "has not come yet"
   تاريخ ≤ آخر يوم مُقفل       ⇐ "is closed already"
   له ملخص مبيعات بالفعل      ⇐ "entered already"
   أول يوم متوقع = آخر مُقفل + 1، متخطيًا الأيام التي سُجلت مبيعاتها   ⇐ لو بدأ الملف بعده: "Missing day …"
   فجوة بين يومين في الملف بلا ملخص مبيعات ⇐ "Missing day … Please include it in the file or mark it as a Closed Day first."
```

التسجيل (`BulkImportSalesHandler`): يعيد الخطة، يرفض بـ 422 لو فيها مشاكل، ثم لكل يوم من الأقدم: `DailySalesWriter.RecordAsync` (المخزون بالوصفات والكومبو، بالمتوسط المتحرك وقت التسجيل: المبيعات لا تحرّكه) ومسودة تقفيل فارغة لليوم لو لم يبدأ. **`SaveChangesAsync` واحد** في النهاية: كل الأيام أو لا شيء. ولأن هذه المسودات الفارغة بعد اليوم التالي المتوقع مقصودة، صار تعريف "المسودة العالقة" (`StrandedDrafts`) = مسودة بعد اليوم التالي **وعليها بيانات** (`HasEntries` أو ملاحظات).

> 📄 **`backend/src/Costing.Application/Sales/BulkDailySales.cs`** — 174 سطر

```csharp
using MediatR;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Menu;
using Costing.Domain.Sales;
using Costing.Application.Books;

namespace Costing.Application.Sales;

// Several days' sales in one sheet (استيراد مبيعات متعدد الأيام): each row with its day in the Date
// column, the days imported oldest first and in the order the end of day keeps (EndOfDaySequence).
// The file starts on the first day after the last closed one whose sales are not in yet, its days
// follow one another (a day between them only when its sales are in already), and none is still to
// come. Previewed first, then recorded all together or not at all: each day's sales summary (its
// stock taken by its recipes and combos, its discounts and why) and, for each day not started yet,
// its end of day as an empty draft, to be closed in turn.

// One day of the sheet: its rows, the items and how many sold, at the menu's prices, its discounts,
// the rows left out, and once recorded its sales summary.
public sealed record BulkSalesDay(DateOnly Date, int Rows, int Items, int Quantity, decimal Value, decimal Discounts, int Skipped, Guid? SaleId = null);

// The sheet read and checked against the days' order: its days oldest first, every row left out and
// why, what stops it (Problems, each in English and Arabic), the last closed day and the day the
// file should start on; recorded, how many end-of-day drafts were made.
public sealed record BulkSalesImport(
    IReadOnlyList<BulkSalesDay> Days,
    IReadOnlyList<SkippedSheetRow> Skipped,
    IReadOnlyList<string> Problems,
    DateOnly? LastClosedDate,
    DateOnly? ExpectedFirstDate,
    bool Ok,
    bool Recorded = false,
    int DraftsCreated = 0);

public sealed record PreviewBulkSalesImportQuery(IReadOnlyList<DailySaleRow> Rows) : IRequest<BulkSalesImport>;

public sealed record BulkImportSalesCommand(IReadOnlyList<DailySaleRow> Rows, string StaffName) : IRequest<BulkSalesImport>, IRetryOnConflict, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => Rows.Select(r => r.Date);
}

internal sealed class BulkSalesPlanner(IMenuRepository menu, ISalesReceiptRepository sales, IEndOfDayRepository days, IBusinessCalendar calendar)
{
    public const int MaxRows = 20_000;
    public const int MaxDays = 31;

    public sealed record Day(DateOnly Date, int Rows, DailySheet Sheet);

    public sealed record Plan(
        IReadOnlyList<Day> Days, IReadOnlyList<SkippedSheetRow> Skipped, IReadOnlyList<string> Problems, DateOnly? LastClosed, DateOnly? ExpectedFirst,
        SaleWriter.Menu Known)
    {
        public BulkSalesImport Result(IReadOnlyDictionary<DateOnly, Guid>? recorded = null, int drafts = 0) => new(
            Days.Select(d => new BulkSalesDay(
                    d.Date, d.Rows, d.Sheet.Items, d.Sheet.Quantity, d.Sheet.Value, d.Sheet.Discounts, d.Sheet.Skipped.Count,
                    recorded?.GetValueOrDefault(d.Date)))
                .ToList(),
            Skipped, Problems, LastClosed, ExpectedFirst, Problems.Count == 0, recorded is not null, drafts);
    }

    public async Task<Plan> PlanAsync(IReadOnlyList<DailySaleRow> rows, CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
            throw new DomainException("The sheet has no rows on it. · الملف لا يحتوي على صفوف.");
        if (rows.Count > MaxRows)
            throw new DomainException($"Import {MaxRows:N0} rows at most at a time. · {MaxRows:N0} صف على الأكثر.");
        var undated = rows.Where(r => r.Date is null).Select(r => r.Row).ToList();
        if (undated.Count > 0)
            throw new DomainException(
                $"Every row needs its day in the Date column (dd/MM/yyyy): {(undated.Count == 1 ? "row" : "rows")} " +
                $"{string.Join(", ", undated.Take(10))}{(undated.Count > 10 ? ", …" : "")} {(undated.Count == 1 ? "has" : "have")} none. " +
                "· كل صف يحتاج تاريخ المبيعات في عمود التاريخ.");
        var groups = rows.GroupBy(r => r.Date!.Value).OrderBy(g => g.Key).ToList();
        if (groups.Count > MaxDays)
            throw new DomainException($"Import {MaxDays} days at most at a time: the sheet has {groups.Count}. · {MaxDays} يومًا على الأكثر في الملف.");

        var known = await SaleWriter.Menu.LoadAsync(menu, cancellationToken);
        var targets = DailySalesItems.Of(known.Items.Values.ToList());
        var problems = new List<string>();
        var planned = new List<Day>();
        foreach (var group in groups)
        {
            var sheet = DailySheet.Read(group, targets, known);
            planned.Add(new Day(group.Key, group.Count(), sheet));
            if (sheet.Lines.Count == 0)
                problems.Add($"No item could be read for {DailySheet.Day(group.Key)}: see the rows left out. · لم يُقرأ أي صنف لهذا اليوم.");
            else if (sheet.Problem(group.Key) is { } problem)
                problems.Add(problem);
        }

        // The days' order (EndOfDaySequence): after the last closed day, never ahead of today.
        var now = DateTime.UtcNow;
        var today = new[] { calendar.BusinessDateOf(now), calendar.LocalDateOf(now) }.Max();
        var lastClosed = await days.LastSubmittedDateAsync(cancellationToken);
        var dates = planned.Select(d => d.Date).ToList();
        foreach (var date in dates)
        {
            if (date > today)
                problems.Add($"{DailySheet.Day(date)} has not come yet: import a day once it is over. · هذا اليوم لم يأتِ بعد.");
            else if (lastClosed is { } last && date <= last)
                problems.Add(
                    $"{DailySheet.Day(date)} is closed already (the last closed day is {DailySheet.Day(last)}): leave it out of the file. " +
                    "· هذا اليوم مُقفل بالفعل.");
            else if (await sales.GetDailySummaryAsync(date, cancellationToken) is not null)
                problems.Add(
                    $"The sales of {DailySheet.Day(date)} are entered already: leave the day out of the file, or void them on Sales first. " +
                    "· مبيعات هذا اليوم مسجلة بالفعل.");
        }

        // The day the file starts on: the first after the last closed day whose sales are not in yet.
        DateOnly? expected = null;
        if (lastClosed is { } closed)
        {
            var day = closed.AddDays(1);
            while (day < today && await sales.GetDailySummaryAsync(day, cancellationToken) is not null)
                day = day.AddDays(1);
            expected = day;
            if (dates[0] > day)
                problems.Add(
                    $"Missing day {DailySheet.Day(day)} in the sequence: the file starts on {DailySheet.Day(dates[0])}. " +
                    "Please include it in the file or mark it as a Closed Day first. " +
                    $"· يوم {DailySheet.Day(day)} مفقود من التسلسل، يرجى إضافته أو إغلاقه كيوم إجازة أولاً.");
        }

        // No day missing between them, unless its sales are in already.
        for (var i = 1; i < dates.Count; i++)
            for (var missing = dates[i - 1].AddDays(1); missing < dates[i]; missing = missing.AddDays(1))
                if (await sales.GetDailySummaryAsync(missing, cancellationToken) is null)
                    problems.Add(
                        $"Missing day {DailySheet.Day(missing)} in the sequence. Please include it in the file or mark it as a Closed Day first. " +
                        $"· يوم {DailySheet.Day(missing)} مفقود من التسلسل، يرجى إضافته أو إغلاقه كيوم إجازة أولاً.");

        return new Plan(planned, planned.SelectMany(d => d.Sheet.Skipped).ToList(), problems, lastClosed, expected, known);
    }
}

internal sealed class PreviewBulkSalesImportHandler(BulkSalesPlanner planner) : IRequestHandler<PreviewBulkSalesImportQuery, BulkSalesImport>
{
    public async Task<BulkSalesImport> Handle(PreviewBulkSalesImportQuery request, CancellationToken cancellationToken) =>
        (await planner.PlanAsync(request.Rows, cancellationToken)).Result();
}

// Recorded all together or not at all, oldest day first: refused whole, naming what stops it, when
// any day is out of order or cannot be read.
internal sealed class BulkImportSalesHandler(BulkSalesPlanner planner, DailySalesWriter writer, IEndOfDayRepository days, IUnitOfWork unitOfWork)
    : IRequestHandler<BulkImportSalesCommand, BulkSalesImport>
{
    public async Task<BulkSalesImport> Handle(BulkImportSalesCommand request, CancellationToken cancellationToken)
    {
        var plan = await planner.PlanAsync(request.Rows, cancellationToken);
        if (plan.Problems.Count > 0)
            throw new DomainException(
                string.Join(" ", plan.Problems.Take(3)) + (plan.Problems.Count > 3 ? $" (and {plan.Problems.Count - 3} more)" : ""));

        var recorded = new Dictionary<DateOnly, Guid>();
        var drafts = 0;
        foreach (var day in plan.Days)
        {
            var receipt = await writer.RecordAsync(
                Guid.NewGuid(), day.Date, day.Sheet.Lines, request.StaffName, plan.Known, cancellationToken, day.Sheet.Discounts, day.Sheet.Reasons);
            recorded[day.Date] = receipt.Id;
            // Its end of day, to be closed in turn: an empty draft, unless one is started already.
            if (await days.GetByDateAsync(day.Date, cancellationToken) is null)
            {
                days.Add(new EndOfDayReport(Guid.NewGuid(), day.Date, request.StaffName));
                drafts++;
            }
        }
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return plan.Result(recorded, drafts);
    }
}
```


`Sales.cs`: `SaleStockPoster` (الخصم بالوصفات)، `SaleWriter`، والمرتجعات (حركة `VoidReturn` تعيد المخزون)، وتقرير المبيعات.

> 📄 **`backend/src/Costing.Application/Sales/Sales.cs`** — 299 سطر

```csharp
using MediatR;
using Microsoft.Extensions.Logging;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Application.Recipes;
using Costing.Domain.Common;
using Costing.Domain.Menu;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.StockMovements;
using Costing.Application.Books;
using Costing.Application.Company;

namespace Costing.Application.Sales;

// Sales (المبيعات): what the menu sold, as every cost report reads it. Entered as a day's sales
// summary, item by item, or imported from the day's sheet (DailySales.cs); a bill as it was
// printed is still taken, for scripts. Each line takes its stock when it is recorded, by the
// recipe it sells by; a sale voided puts that back, exactly as it was taken (Deletions,
// ApprovalModule.Sale), and leaves the reports.

public sealed record SalesLineDto(
    Guid PublicId, int MenuItemId, int? VariantId, string MenuItemName, string? VariantName, int Quantity, decimal LineTotal, IReadOnlyList<int> AddOnIds,
    bool OnBill, LineVoid Voided);

public sealed record SalesReceiptDto(
    Guid Id,
    string? Reference,
    DateTime SoldAtUtc,
    DateOnly BusinessDate,
    SalesChannel Channel,
    PaymentMethod PaymentMethod,
    IReadOnlyList<SalesLineDto> Lines,
    decimal Subtotal,
    decimal DiscountAmount,
    decimal DeliveryFee,
    decimal TaxAmount,
    decimal PointsAmount,
    decimal TotalAmount,
    decimal RefundedAmount,
    string? Notes,
    SalesSource Source,
    string EnteredBy,
    DateTime EnteredAtUtc,
    DateTime? VoidedAtUtc,
    string? VoidedBy)
{
    public static SalesReceiptDto From(SalesReceipt r) => new(
        r.Id, r.Reference, r.SoldAtUtc, r.BusinessDate, r.Channel, r.PaymentMethod,
        r.Lines.Select(l => new SalesLineDto(
                l.PublicId, l.MenuItemId, l.VariantId, l.MenuItemName, l.VariantName, l.Quantity, l.LineTotal, l.AddOnIds, l.OnBill, l.Voided))
            .ToList(),
        r.BilledSubtotal, r.DiscountAmount, r.DeliveryFee, r.TaxAmount, r.PointsAmount, r.TotalAmount, r.RefundedAmount, r.Notes, r.Source, r.EnteredBy,
        r.EnteredAtUtc, r.VoidedAtUtc, r.VoidedBy);
}

// A period's sales, voided ones listed but not counted. ByPayment: what was charged, less what was
// handed back, by how it was paid.
public sealed record SalesTotals(
    int Receipts, int Items, decimal Subtotal, decimal Discounts, decimal DeliveryFees, decimal Tax, decimal Points, decimal Total, decimal Refunded,
    IReadOnlyDictionary<PaymentMethod, decimal> ByPayment);

public sealed record SalesReport(DateOnly From, DateOnly To, IReadOnlyList<SalesReceiptDto> Receipts, SalesTotals Totals);

// One line as entered: an item (a size of it), how many, with which add-ons. LineTotal, what it
// came to: left out, the menu's price (the size's, or the item's) and its add-ons', times how many.
// Voided: taken off the bill, and when (LineVoid).
public sealed record SaleLineInput(
    int MenuItemId, int? VariantId, int Quantity, decimal? LineTotal = null, IReadOnlyList<int>? AddOnIds = null, LineVoid Voided = LineVoid.None);

// A sale as entered. Date is its business day; Time, when it was paid (a time before the business
// day starts is that night's, past midnight); none, the day's middle. Its id is made by the app.
public sealed record SaleInput(
    Guid Id,
    string? Reference,
    DateOnly Date,
    TimeOnly? Time,
    SalesChannel Channel,
    PaymentMethod PaymentMethod,
    IReadOnlyList<SaleLineInput> Lines,
    decimal DiscountAmount = 0,
    decimal DeliveryFee = 0,
    decimal TaxAmount = 0,
    decimal PointsAmount = 0,
    decimal RefundedAmount = 0,
    string? Notes = null,
    // Why the discount was given (a day's summary from the POS: its Z reports' reasons).
    IReadOnlyList<DiscountReason>? DiscountReasons = null);

// Turns sold lines into stock movements, each material's share as purchased, by the recipe each
// sells by: Sale for a line charged, then VoidReturn for one refunded after payment, and Waste for
// one voided after the kitchen made it. A line already posted for a reason is skipped, so a
// retried sale posts once. Adds the movements; the caller saves.
internal sealed class SaleStockPoster(
    IRecipeRepository recipes,
    IComboOfferRepository combos,
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    ILogger<SaleStockPoster> logger)
{
    public Task PostAsync(IReadOnlyCollection<SalesReceiptLine> lines, CancellationToken cancellationToken) =>
        PostAsync(lines
            .SelectMany(l => l.Voided switch
            {
                LineVoid.None => [(l, StockMovementReason.Sale)],
                LineVoid.AfterKitchen => [(l, StockMovementReason.Waste)],
                LineVoid.AfterPayment => new[] { (l, StockMovementReason.Sale), (l, StockMovementReason.VoidReturn) },
                _ => [],
            })
            .ToList(), cancellationToken);

    // Lines refunded on a sale already recorded: only their stock put back. What they sold was
    // taken when the sale was, under the line a refund split them from.
    public Task PostReturnsAsync(IReadOnlyCollection<SalesReceiptLine> lines, CancellationToken cancellationToken) =>
        PostAsync(lines.Select(l => (l, StockMovementReason.VoidReturn)).ToList(), cancellationToken);

    private async Task PostAsync(IReadOnlyList<(SalesReceiptLine Line, StockMovementReason Reason)> posts, CancellationToken cancellationToken)
    {
        var pending = new List<(Guid LineId, SoldItem Item, StockMovementReason Reason)>();
        foreach (var (line, reason) in posts)
        {
            if (!await movements.ExistsAsync(line.PublicId, reason, cancellationToken))
                pending.Add((line.PublicId, new SoldItem(line.MenuItemId, line.VariantId, line.AddOnIds, line.Quantity), reason));
        }
        if (pending.Count == 0)
            return;

        var (relevant, parts) = await recipes.ForSaleAsync(combos, pending.Select(p => p.Item).ToList(), cancellationToken);
        var needs = pending.Select(p => (p.LineId, p.Reason, Needs: StockRequirements.For(p.Item, relevant, parts),
            Station: p.Reason == StockMovementReason.Waste ? StockRequirements.StationOf(p.Item, relevant) : null)).ToList();
        var materialsById = (await materials.GetByIdsAsync(needs.SelectMany(n => n.Needs.Keys).Distinct().ToList(), cancellationToken))
            .ToDictionary(m => m.Id);

        foreach (var (lineId, reason, need, station) in needs)
        {
            foreach (var (rawMaterialId, quantity) in need)
            {
                // Should not happen: raw materials are never deleted.
                if (!materialsById.TryGetValue(rawMaterialId, out var material))
                {
                    logger.LogWarning("Raw material {RawMaterialId} in a recipe does not exist; sale line {LineId} not posted against it", rawMaterialId, lineId);
                    continue;
                }

                movements.Add(reason switch
                {
                    StockMovementReason.Sale => material.RecordSale(quantity, lineId),
                    // Voided after the kitchen made it: the waste of the station that made the dish.
                    StockMovementReason.Waste => material.RecordWaste(quantity, lineId, station),
                    _ => material.RecordVoidReturn(quantity, lineId),
                });
            }
        }
    }
}

// A sale built from what was entered: each line checked against the menu, its names kept as they
// are today, and its total the menu's when none is given.
internal sealed class SaleWriter(IMenuRepository menu, ISalesReceiptRepository sales, IBusinessCalendar calendar, SaleStockPoster poster)
{
    public async Task<SalesReceipt> RecordAsync(SaleInput input, SalesSource source, string by, Menu? loaded, CancellationToken cancellationToken)
    {
        var known = loaded ?? await Menu.LoadAsync(menu, cancellationToken);
        if (input.Lines is not { Count: > 0 })
            throw new DomainException("Add at least one item.");
        var lines = input.Lines.Select(line => Line(line, known)).ToList();

        var local = input.Date.ToDateTime(input.Time ?? new TimeOnly(12, 0));
        var startsAt = calendar.Bounds(input.Date).FromUtc;
        var soldAt = calendar.ToUtc(local);
        // A time before the business day starts is that night's, past midnight.
        if (soldAt < startsAt)
            soldAt = calendar.ToUtc(local.AddDays(1));

        var receipt = new SalesReceipt(
            input.Id, input.Reference, soldAt, input.Date, input.Channel, input.PaymentMethod, lines, Money(input.DiscountAmount), Money(input.DeliveryFee),
            Money(input.TaxAmount), Money(input.PointsAmount), Money(input.RefundedAmount), input.Notes, source, by, input.DiscountReasons);
        sales.Add(receipt);
        await poster.PostAsync(receipt.Lines, cancellationToken);
        return receipt;
    }

    // What the lines charged come to at the menu's prices (or as given): a sale's subtotal before it is made.
    public static decimal ValueOf(IEnumerable<SaleLineInput> lines, Menu known) =>
        lines.Where(l => l.Voided is LineVoid.None or LineVoid.AfterPayment).Sum(l => Line(l, known).LineTotal);

    private static SalesReceiptLine Line(SaleLineInput line, Menu known)
    {
        var item = known.Items.GetValueOrDefault(line.MenuItemId) ?? throw new DomainException($"There is no item {line.MenuItemId} on the menu.");
        MenuItemVariant? size = null;
        if (line.VariantId is { } variantId)
        {
            size = item.Variants.SingleOrDefault(v => v.Id == variantId)
                ?? throw new DomainException($"{item.Name} has no such size: choose one of its sizes.");
        }
        else if (item.Variants.Count > 0)
        {
            throw new DomainException($"{item.Name} is sold by size: choose its size.");
        }

        var addOnIds = (line.AddOnIds ?? []).Distinct().ToList();
        var addOns = addOnIds.Select(id => known.AddOns.GetValueOrDefault(id) ?? throw new DomainException($"There is no add-on {id} on the menu.")).ToList();
        if (line.Quantity <= 0)
            throw new DomainException($"Sell at least one {item.Name}.");
        var total = line.LineTotal ?? ((size?.Price ?? item.Price) + addOns.Sum(a => a.Price)) * line.Quantity;
        return new SalesReceiptLine(item.Id, size?.Id, item.Name, size?.Name, line.Quantity, Money(total), addOnIds, line.Voided);
    }

    internal static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    // The menu as a sale checks it: every item and add-on, deleted ones too (an old sale may name one).
    internal sealed record Menu(IReadOnlyDictionary<int, MenuItem> Items, IReadOnlyDictionary<int, AddOn> AddOns)
    {
        public static async Task<Menu> LoadAsync(IMenuRepository menu, CancellationToken cancellationToken) => new(
            (await menu.GetItemsAsync(cancellationToken)).ToDictionary(i => i.Id),
            (await menu.GetAddOnsAsync(cancellationToken)).ToDictionary(a => a.Id));
    }
}

public sealed record RecordSaleCommand(SaleInput Sale, string StaffName) : IRequest<SalesReceiptDto>, IRetryOnConflict, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Sale.Date];
}

internal sealed class RecordSaleHandler(ISalesReceiptRepository sales, SaleWriter writer, IUnitOfWork unitOfWork)
    : IRequestHandler<RecordSaleCommand, SalesReceiptDto>
{
    public async Task<SalesReceiptDto> Handle(RecordSaleCommand request, CancellationToken cancellationToken)
    {
        // Sent again after a lost answer: already recorded.
        if (await sales.GetByIdAsync(request.Sale.Id, cancellationToken) is { } already)
            return SalesReceiptDto.From(already);
        if (request.Sale.Reference is { } reference && !string.IsNullOrWhiteSpace(reference)
            && (await sales.GetReferencesAsync([reference.Trim()], cancellationToken)).Count > 0)
            throw new DomainException($"Receipt {reference.Trim()} is recorded already.");

        var receipt = await writer.RecordAsync(request.Sale, SalesSource.Entered, request.StaffName, null, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return SalesReceiptDto.From(receipt);
    }
}

// Handed back after it was paid: Quantity of a line, or the whole sale (no line). Its money is
// added to the refund, its ingredients put back into stock. Entered as it happened, as a sale is.
public sealed record RefundSaleCommand(Guid SaleId, Guid? LinePublicId, int? Quantity, string StaffName) : IRequest<SalesReceiptDto>, IRetryOnConflict, IBooksEntry
{
    bool IBooksEntry.WritesToday => true;
}

internal sealed class RefundSaleHandler(ISalesReceiptRepository sales, SaleStockPoster poster, IUnitOfWork unitOfWork)
    : IRequestHandler<RefundSaleCommand, SalesReceiptDto>
{
    public async Task<SalesReceiptDto> Handle(RefundSaleCommand request, CancellationToken cancellationToken)
    {
        var sale = await sales.GetByIdAsync(request.SaleId, cancellationToken) ?? throw new NotFoundException("Sale", request.SaleId);
        var refunded = new List<SalesReceiptLine>();
        if (request.LinePublicId is { } lineId)
        {
            var line = sale.Lines.SingleOrDefault(l => l.PublicId == lineId) ?? throw new DomainException("That line is not on this sale.");
            refunded.Add(sale.Refund(lineId, request.Quantity ?? line.Quantity));
        }
        else
        {
            var onBill = sale.Lines.Where(l => l.OnBill).ToList();
            if (onBill.Count == 0)
                throw new DomainException("Everything on this sale is refunded or voided already.");
            foreach (var line in onBill)
                refunded.Add(sale.Refund(line.PublicId, line.Quantity));
        }

        await poster.PostReturnsAsync(refunded, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return SalesReceiptDto.From(sale);
    }
}

// The sales of From to To (business days), newest first.
public sealed record GetSalesQuery(DateOnly From, DateOnly To) : IRequest<SalesReport>;

internal sealed class GetSalesHandler(ISalesReceiptRepository sales, ICurrentBranch branch) : IRequestHandler<GetSalesQuery, SalesReport>
{
    public async Task<SalesReport> Handle(GetSalesQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From)
            throw new DomainException("The period ends before it starts.");
        if (request.To.DayNumber - request.From.DayNumber > 92)
            throw new DomainException("Show three months of sales at most.");
        // The branch's own, when the company has several.
        var receipts = await branch.NarrowAsync(await sales.GetForDaysAsync(request.From, request.To, cancellationToken), cancellationToken);
        var counted = receipts.Where(r => !r.IsVoided).ToList();
        var totals = new SalesTotals(
            counted.Count, counted.Sum(r => r.Lines.Where(l => l.OnBill).Sum(l => l.Quantity)), counted.Sum(r => r.BilledSubtotal),
            counted.Sum(r => r.DiscountAmount), counted.Sum(r => r.DeliveryFee), counted.Sum(r => r.TaxAmount), counted.Sum(r => r.PointsAmount),
            counted.Sum(r => r.TotalAmount), counted.Sum(r => r.RefundedAmount),
            Enum.GetValues<PaymentMethod>().ToDictionary(m => m, m => counted.Where(r => r.PaymentMethod == m).Sum(r => r.TotalAmount - r.RefundedAmount)));
        return new SalesReport(request.From, request.To, receipts.Select(SalesReceiptDto.From).ToList(), totals);
    }
}
```


---

## 4. الجرد: الافتتاحي مقابل الدوري

### 4.1 الفرق المحاسبي (مهم جدًا)

| | الجرد الافتتاحي (`Opening`) | الجرد الدوري (`Periodic`) |
| --- | --- | --- |
| متى | مرة لكل خامة، عند بدء النظام | دوريًا (أسبوعيًا مثلًا، بالمطبخ مغلقًا) |
| الحركة | `OpeningStock` | `CountAdjustment` |
| المعنى | **بداية** القيم، لا "فرق" | **عجز أو زيادة**: الفرق بين الدفتر والواقع |
| التقييم | بالمتوسط الموجود؛ والمصنّع بلا متوسط **بتكلفة وصفته اليوم** (`OpenStock(..., unitCost)`) | بالمتوسط وقتها |
| في الـ KPIs وقائمة الدخل والفروقات | **مستبعد** | **داخل** (فروقات الجرد تكلفة) |

**لماذا هذا الفصل؟** لو اعتبرنا الجرد الافتتاحي "زيادة"، لظهر في أول شهر ربح وهمي ضخم (كل المخزون "وُجد فجأة"). الافتتاحي يضع نقطة البداية فقط.

- **تُفتتح الخامة مرة واحدة** (`CountedBeforeAsync`)، وإلغاء الجرد يحررها.
- **تقرير الفروقات ينتهي عند جرد دوري فقط** (لا معنى لفرق عند نقطة البداية).

### 4.2 الكود

المسودة تُحفظ أثناء العد (العد قد يستغرق ساعة، والتابلت قد ينام)، ونوعها يمكن تغييره قبل الترحيل، ثم `PostStockCountCommand` يضبط كل خامة **معدودة** على المعدود: ما لم يُعد يبقى رصيده كما هو، ولذلك يصلح الترحيل نفسه للجرد الجزئي (Spot) دون منطق خاص. معرّف الجرد من المتصفح.

**الجرد الأعمى (Blind):** `StockCountDto.ShowAsync(count, blind, …)` هو المكان الوحيد الذي يقرر ما يُعرض: في المسودة الرصيد الدفتري الحي (`QuantityOnHand`) والتكلفة (`AverageCost`) لمن يراجع، وفي الجرد المرحّل القيم المحفوظة، وفي الوضع الأعمى يُحذفان معًا. والـ API يفرضه: `Blind(asked) => asked || !costing.view`، فأمين المخزن لا يرى الدفتري ولو طلبه. لذلك الترحيل وطلب إعادة الجرد لمن يملك `costing.view` فقط، والعادّ الأعمى **يسلّم للمراجعة** (`SubmitStockCountCommand`). و `GetCountItemsQuery` يعطي ورقة العد الأصناف بلا رصيد ولا تكلفة.

> 📄 **`backend/src/Costing.Application/StockCounts/StockCounts.cs`** — 382 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Application.Categories;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Categories;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Application.Books;
using Costing.Application.Company;

namespace Costing.Application.StockCounts;

// Physical counts of the stores. A count is filled in as a draft, saved as it goes (a count can
// take an hour, and a tablet can sleep), then posted, which sets stock to what was counted.
// StockCountId is made by the till, as PurchaseId is. The names of who started and posted it
// are set by the API from who is signed in.
//
// A count is periodic (جرد دوري), what is found against the records a shortage or a surplus, or
// the opening stock (جرد افتتاحي): where each material's stock begins when costing starts,
// valued at its cost, with no shortage or surplus against the zero before it, so neither the
// KPIs nor the profit see it. A material is opened once: one in a posted count already is
// counted periodically from then on.
//
// A periodic count is full (جرد شامل) or a spot count (جرد يومي سريع) of a chosen few; posting
// either moves only the materials counted in it. Who counts may count blind (الجرد الأعمى): the
// API leaves the records' figures and the costs out of what such a counter is sent, and a counter
// who counts blind hands the count in for a manager or a cost controller to reconcile and post.

// What a count sheet shows of each line. BookQuantity and UnitCost are what the records say: on a
// posted count, as they were at posting; on a draft, as they are now, for whoever reconciles it.
// Left out (null) for whoever counts blind: a storekeeper, or anyone counting with blind mode on.
public sealed record StockCountLineDto(
    Guid RawMaterialId, decimal CountedQuantity, decimal? BookQuantity, decimal? UnitCost, string? Note = null, bool RecountRequested = false);

public sealed record StockCountDto(
    Guid Id,
    StockCountStatus Status,
    DateTime StartedAtUtc,
    string StartedBy,
    DateTime? PostedAtUtc,
    string? PostedBy,
    IReadOnlyList<StockCountLineDto> Lines,
    DateTime? VoidedAtUtc = null,
    string? VoidedBy = null,
    StockCountKind Kind = StockCountKind.Periodic,
    StockCountScope Scope = StockCountScope.Full,
    IReadOnlyList<Guid>? ScopeMaterialIds = null,
    string? ScopeLabel = null,
    StockCountReview Review = StockCountReview.Counting,
    string? SubmittedBy = null,
    DateTime? SubmittedAtUtc = null,
    string? ReviewedBy = null,
    DateTime? ReviewedAtUtc = null,
    string? ReviewNote = null,
    // Shown blind: the records' figures and the costs left out.
    bool Blind = false)
{
    // live: the draft's materials as they stand, for the records' figures now. Blind, none at all.
    public static StockCountDto From(StockCount count, bool blind = false, IReadOnlyDictionary<Guid, RawMaterial>? live = null) => new(
        count.Id, count.Status, count.StartedAtUtc, count.StartedBy, count.PostedAtUtc, count.PostedBy,
        count.Lines.Select(l =>
        {
            var (book, cost) = blind ? (null, null)
                : count.Status == StockCountStatus.Draft
                    ? (live?.GetValueOrDefault(l.RawMaterialId)?.QuantityOnHand, live?.GetValueOrDefault(l.RawMaterialId)?.AverageCost)
                    : (l.BookQuantity, l.UnitCost);
            return new StockCountLineDto(l.RawMaterialId, l.CountedQuantity, book, cost, l.Note, l.RecountRequested);
        }).ToList(),
        count.VoidedAtUtc, count.VoidedBy, count.Kind, count.Scope, count.ScopeMaterialIds, count.ScopeLabel, count.Review, count.SubmittedBy,
        count.SubmittedAtUtc, count.ReviewedBy, count.ReviewedAtUtc, count.ReviewNote, blind);

    // As the caller may see it: a draft not blind with the records' figures now.
    public static async Task<StockCountDto> ShowAsync(StockCount count, bool blind, IRawMaterialRepository materials, CancellationToken cancellationToken)
    {
        if (blind || count.Status != StockCountStatus.Draft || count.Lines.Count == 0)
            return From(count, blind);
        var live = (await materials.GetByIdsAsync(count.Lines.Select(l => l.RawMaterialId).ToList(), cancellationToken)).ToDictionary(m => m.Id);
        return From(count, blind, live);
    }
}

// In the material's unit: grams, millilitres, pieces; with the counter's note, if any.
public sealed record StockCountLine(Guid RawMaterialId, decimal CountedQuantity, string? Note = null);

public sealed record StockCountSummaryDto(
    Guid Id, StockCountStatus Status, DateTime StartedAtUtc, string StartedBy, DateTime? PostedAtUtc, string? PostedBy, int Materials,
    DateTime? VoidedAtUtc = null, string? VoidedBy = null, StockCountKind Kind = StockCountKind.Periodic,
    StockCountScope Scope = StockCountScope.Full, string? ScopeLabel = null, int ScopeSize = 0,
    StockCountReview Review = StockCountReview.Counting, string? SubmittedBy = null, DateTime? SubmittedAtUtc = null);

// The draft first, if there is one, then the posted counts, newest first.
public sealed record GetStockCountsQuery : IRequest<IReadOnlyList<StockCountSummaryDto>>;

internal sealed class GetStockCountsQueryHandler(IStockCountRepository counts, ICurrentBranch branch)
    : IRequestHandler<GetStockCountsQuery, IReadOnlyList<StockCountSummaryDto>>
{
    public async Task<IReadOnlyList<StockCountSummaryDto>> Handle(GetStockCountsQuery request, CancellationToken cancellationToken) =>
        (await branch.NarrowAsync(await counts.GetAllAsync(cancellationToken), cancellationToken))
            .OrderBy(c => c.Status)
            .ThenByDescending(c => c.PostedAtUtc ?? c.StartedAtUtc)
            .Select(c => new StockCountSummaryDto(
                c.Id, c.Status, c.StartedAtUtc, c.StartedBy, c.PostedAtUtc, c.PostedBy, c.Lines.Count, c.VoidedAtUtc, c.VoidedBy, c.Kind,
                c.Scope, c.ScopeLabel, c.ScopeMaterialIds.Length, c.Review, c.SubmittedBy, c.SubmittedAtUtc))
            .ToList();
}

// Blind: as its counter sees it, without the records' figures or the costs.
public sealed record GetStockCountQuery(Guid StockCountId, bool Blind = false) : IRequest<StockCountDto?>;

internal sealed class GetStockCountQueryHandler(IStockCountRepository counts, IRawMaterialRepository materials) : IRequestHandler<GetStockCountQuery, StockCountDto?>
{
    public async Task<StockCountDto?> Handle(GetStockCountQuery request, CancellationToken cancellationToken) =>
        await counts.GetByIdAsync(request.StockCountId, cancellationToken) is { } count
            ? await StockCountDto.ShowAsync(count, request.Blind, materials, cancellationToken)
            : null;
}

// Creates the draft on its first save. Only one draft at a time: a second is refused, naming the
// one still open. Kind: periodic or opening, as it starts or changed while a draft; none keeps it.
// Scope: full, or a spot count of ScopeMaterialIds (named ScopeLabel); none keeps it.
public sealed record SaveStockCountCommand(
    Guid StockCountId,
    IReadOnlyList<StockCountLine> Lines,
    string StaffName = "",
    StockCountKind? Kind = null,
    StockCountScope? Scope = null,
    IReadOnlyList<Guid>? ScopeMaterialIds = null,
    string? ScopeLabel = null,
    bool Blind = false)
    : IRequest<StockCountDto>;

internal sealed class SaveStockCountCommandHandler(
    IStockCountRepository counts,
    IRawMaterialRepository materials,
    IUnitOfWork unitOfWork) : IRequestHandler<SaveStockCountCommand, StockCountDto>
{
    public async Task<StockCountDto> Handle(SaveStockCountCommand request, CancellationToken cancellationToken)
    {
        // Every listed material must exist; an empty draft is allowed while it is being started.
        var named = request.Lines.Select(l => l.RawMaterialId).Concat(request.ScopeMaterialIds ?? []).Distinct().ToList();
        if (named.Count > 0)
            await materials.GetRequiredByIdsAsync(named, cancellationToken);

        var count = await counts.GetByIdAsync(request.StockCountId, cancellationToken);
        if (count is null)
        {
            if (await counts.GetDraftAsync(cancellationToken) is { } open)
                throw new DomainException(
                    $"{open.StartedBy} started a count at {open.StartedAtUtc:HH:mm} UTC that is still open: finish or discard it first.");
            count = new StockCount(
                request.StockCountId, request.StaffName, request.Kind ?? StockCountKind.Periodic, request.Scope ?? StockCountScope.Full,
                request.ScopeMaterialIds, request.ScopeLabel);
            counts.Add(count);
        }
        else
        {
            if (request.Kind is { } kind)
                count.SetKind(kind);
            if (request.Scope is { } scope)
                count.SetScope(scope, request.ScopeMaterialIds ?? [], request.ScopeLabel);
        }

        count.Record(request.Lines.Select(l => (l.RawMaterialId, l.CountedQuantity, l.Note)).ToList());
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await StockCountDto.ShowAsync(count, request.Blind, materials, cancellationToken);
    }
}

// Handed in by its counter (تسليم الجرد للمراجعة), for a manager or cost controller to reconcile
// against the records and post: a counter who counts blind never posts.
public sealed record SubmitStockCountCommand(Guid StockCountId, string StaffName = "", bool Blind = false) : IRequest<StockCountDto>;

internal sealed class SubmitStockCountCommandHandler(IStockCountRepository counts, IRawMaterialRepository materials, IUnitOfWork unitOfWork)
    : IRequestHandler<SubmitStockCountCommand, StockCountDto>
{
    public async Task<StockCountDto> Handle(SubmitStockCountCommand request, CancellationToken cancellationToken)
    {
        var count = await counts.GetRequiredAsync(request.StockCountId, cancellationToken);
        count.Submit(request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await StockCountDto.ShowAsync(count, request.Blind, materials, cancellationToken);
    }
}

// Lines sent back to be weighed again (مطلوب إعادة جرد), by who reconciles the count; the counter
// sees which and the note, never what the records expect.
public sealed record RequestStockCountRecountCommand(Guid StockCountId, IReadOnlyList<Guid> RawMaterialIds, string? Note, string StaffName = "")
    : IRequest<StockCountDto>;

internal sealed class RequestStockCountRecountCommandHandler(IStockCountRepository counts, IRawMaterialRepository materials, IUnitOfWork unitOfWork)
    : IRequestHandler<RequestStockCountRecountCommand, StockCountDto>
{
    public async Task<StockCountDto> Handle(RequestStockCountRecountCommand request, CancellationToken cancellationToken)
    {
        var count = await counts.GetRequiredAsync(request.StockCountId, cancellationToken);
        count.RequestRecount(request.RawMaterialIds ?? [], request.Note, request.StaffName);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await StockCountDto.ShowAsync(count, blind: false, materials, cancellationToken);
    }
}

// What a count sheet lists: each material and prep item by its code, name, category and the unit
// it is counted in, whether it is a daily critical item, and nothing of its stock or its cost, so
// a sheet counted blind carries neither.
public sealed record CountItemDto(
    Guid Id,
    string? Code,
    string Name,
    Guid CategoryId,
    string Category,
    string? CategoryAr,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    bool IsPrepItem,
    bool IsSpotCheckItem,
    bool IsArchived,
    // The kitchen or bar station that keeps it, for a count of one station.
    Guid? KitchenStationId = null);

public sealed record GetCountItemsQuery : IRequest<IReadOnlyList<CountItemDto>>;

internal sealed class GetCountItemsQueryHandler(IRawMaterialRepository materials, IPurchaseCategoryRepository categories)
    : IRequestHandler<GetCountItemsQuery, IReadOnlyList<CountItemDto>>
{
    public async Task<IReadOnlyList<CountItemDto>> Handle(GetCountItemsQuery request, CancellationToken cancellationToken)
    {
        var byId = (await categories.GetAllAsync(cancellationToken)).ToDictionary(c => c.Id);
        return (await materials.GetAllAsync(cancellationToken))
            .Select(m =>
            {
                var category = byId.GetValueOrDefault(m.CategoryId);
                return new CountItemDto(
                    m.Id, m.Code, m.Name, m.CategoryId, category?.Name ?? PurchaseCategory.GeneralName, category?.NameAr, m.Unit, m.PurchaseUnit,
                    m.PurchaseUnitSize, m.IsPrepItem, m.IsSpotCheckItem, m.IsArchived, m.KitchenStationId);
            })
            .OrderBy(i => i.Category, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(i => i.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }
}

// Starred, or not, as a daily critical item (جرد يومي سريع): a flag, no stock moves.
public sealed record SetSpotCheckItemCommand(Guid RawMaterialId, bool IsSpotCheckItem) : IRequest<bool>;

internal sealed class SetSpotCheckItemCommandHandler(IRawMaterialRepository materials, IUnitOfWork unitOfWork)
    : IRequestHandler<SetSpotCheckItemCommand, bool>
{
    public async Task<bool> Handle(SetSpotCheckItemCommand request, CancellationToken cancellationToken)
    {
        var material = await materials.GetRequiredAsync(request.RawMaterialId, cancellationToken);
        material.MarkSpotCheck(request.IsSpotCheckItem);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return material.IsSpotCheckItem;
    }
}

// Posting again, after an answer was lost, returns the posted count and changes nothing.
public sealed record PostStockCountCommand(Guid StockCountId, string StaffName = "") : IRequest<StockCountDto>, IRetryOnConflict, IBooksEntry
{
    bool IBooksEntry.WritesToday => true;
}

internal sealed class PostStockCountCommandHandler(
    IStockCountRepository counts,
    IRawMaterialRepository materials,
    IPrepRecipeRepository prepRecipes,
    IStockMovementRepository movements,
    IBusinessCalendar clock,
    IUnitOfWork unitOfWork) : IRequestHandler<PostStockCountCommand, StockCountDto>
{
    public async Task<StockCountDto> Handle(PostStockCountCommand request, CancellationToken cancellationToken)
    {
        var count = await counts.GetRequiredAsync(request.StockCountId, cancellationToken);
        if (count.Status == StockCountStatus.Posted)
            return StockCountDto.From(count);

        IReadOnlyDictionary<Guid, RawMaterial> byId = count.Lines.Count == 0
            ? new Dictionary<Guid, RawMaterial>()
            : await materials.GetRequiredByIdsAsync(count.Lines.Select(l => l.RawMaterialId).ToList(), cancellationToken);
        var costs = await CountPosting.CheckAsync(count, byId, counts, materials, prepRecipes, clock, cancellationToken);
        foreach (var movement in count.Post(byId, request.StaffName, costs))
            movements.Add(movement);

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return StockCountDto.From(count);
    }
}

internal static class CountPosting
{
    // An opening count: none of its materials counted before, and what a prep item never made is
    // valued at by its recipe. Null for a periodic count, which needs neither.
    public static async Task<RecipeCosts?> CheckAsync(
        StockCount count, IReadOnlyDictionary<Guid, RawMaterial> byId, IStockCountRepository counts, IRawMaterialRepository materials,
        IPrepRecipeRepository prepRecipes, IBusinessCalendar clock, CancellationToken cancellationToken)
    {
        if (!count.IsOpening || count.Lines.Count == 0)
            return null;

        var before = await counts.CountedBeforeAsync(byId.Keys.ToList(), count.Id, cancellationToken);
        if (before.Count > 0)
        {
            var names = before.Keys.Select(id => byId[id].Name).Order(StringComparer.CurrentCultureIgnoreCase).ToList();
            var named = names.Count <= 5 ? Join(names) : $"{string.Join(", ", names.Take(5))} and {names.Count - 5} more";
            var first = clock.BusinessDateOf(before.Values.Min());
            throw new DomainException(
                $"{named} {(names.Count == 1 ? "was" : "were")} counted already, first on {first.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}: what is found now is a shortage or a surplus. " +
                "Count them in a periodic count, or leave them out of the opening stock. · " +
                "خامات جُردت من قبل: تُجرد جردًا دوريًا أو تُترك خارج الجرد الافتتاحي.");
        }

        if (!byId.Values.Any(m => m.IsPrepItem))
            return null;
        return new RecipeCosts(
            (await materials.GetAllAsync(cancellationToken)).ToDictionary(m => m.Id), await prepRecipes.GetAllAsync(cancellationToken));
    }

    private static string Join(IReadOnlyList<string> names) =>
        names.Count == 1 ? names[0] : $"{string.Join(", ", names.Take(names.Count - 1))} and {names[^1]}";
}

public sealed record DiscardStockCountCommand(Guid StockCountId) : IRequest;

internal sealed class DiscardStockCountCommandHandler(IStockCountRepository counts, IUnitOfWork unitOfWork)
    : IRequestHandler<DiscardStockCountCommand>
{
    public async Task Handle(DiscardStockCountCommand request, CancellationToken cancellationToken)
    {
        // Already gone: a retry of a discard that worked.
        if (await counts.GetByIdAsync(request.StockCountId, cancellationToken) is not { } count)
            return;
        if (count.Status == StockCountStatus.Posted)
            throw new DomainException("A posted count stays: it is part of the stock's history.");

        counts.Remove(count);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}

// A whole count in one request: recorded and posted at once. For a quick count of a few
// materials, and for scripts; the screens use a draft.
public sealed record RecordStockCountCommand(
    Guid StockCountId, IReadOnlyList<StockCountLine> Lines, string StaffName = "", StockCountKind Kind = StockCountKind.Periodic)
    : IRequest<IReadOnlyList<RawMaterialDto>>, IRetryOnConflict, IBooksEntry
{
    bool IBooksEntry.WritesToday => true;
}

internal sealed class RecordStockCountCommandHandler(
    IStockCountRepository counts,
    IRawMaterialRepository materials,
    IPrepRecipeRepository prepRecipes,
    IStockMovementRepository movements,
    IPurchaseCategoryRepository categories,
    IBusinessCalendar clock,
    IUnitOfWork unitOfWork) : IRequestHandler<RecordStockCountCommand, IReadOnlyList<RawMaterialDto>>
{
    public async Task<IReadOnlyList<RawMaterialDto>> Handle(RecordStockCountCommand request, CancellationToken cancellationToken)
    {
        var byId = await materials.GetRequiredByIdsAsync(
            request.Lines.Select(l => l.RawMaterialId).ToList(), cancellationToken);

        if (await counts.GetByIdAsync(request.StockCountId, cancellationToken) is null)
        {
            var count = new StockCount(request.StockCountId, request.StaffName, request.Kind);
            count.Record(request.Lines.Select(l => (l.RawMaterialId, l.CountedQuantity)).ToList());
            var costs = await CountPosting.CheckAsync(count, byId, counts, materials, prepRecipes, clock, cancellationToken);
            counts.Add(count);
            foreach (var movement in count.Post(byId, request.StaffName, costs))
                movements.Add(movement);

            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return await categories.DtosAsync(byId.Values, cancellationToken);
    }
}
```


## 5. الهالك والكسر

- **الهالك (Spoilage):** مخزون تالف (منتهي، فاسد، وقع) ⇐ يخرج من المخزون بحركة بسبب، وتقرير الفروقات يضعه **مقابل العجز**، فالخسارة المعروف سببها لا تُخلط بخسارة بلا سبب. وأطباق أُلغيت بعد أن صنعها المطبخ تُحسب هالكًا أيضًا.
- **الكسر (Breakage):** أطباق وكاسات ومستهلكات: **ليست مخزونًا**، تكلفتها على اليوم مباشرة (قيد في `BreakageEntries`)، وإلغاؤه عبر موافقة.

> 📄 **`backend/src/Costing.Application/Waste/Breakage.cs`** — 80 سطر

```csharp
using MediatR;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Staff;
using Costing.Domain.Waste;
using Costing.Application.Books;
using Costing.Application.Company;

namespace Costing.Application.Waste;

// Breakage (كسر) on Waste: consumables broken on a business day, at their cost. Entered here; voided
// through an approval (ApprovalModule.Breakage), as the other voids are.

public sealed record BreakageEntryDto(
    Guid Id,
    DateOnly BusinessDate,
    Guid? AssetItemId,
    Guid? AssetTransactionId,
    string Description,
    int Quantity,
    decimal? UnitCost,
    decimal Cost,
    Guid? EmployeeId,
    string? EmployeeName,
    string? Notes,
    string RecordedBy,
    DateTime RecordedAtUtc,
    bool IsVoided);

// The business days from From to To, voided entries too.
public sealed record GetBreakageQuery(DateOnly From, DateOnly To) : IRequest<IReadOnlyList<BreakageEntryDto>>;

internal sealed class GetBreakageHandler(IBreakageEntryRepository breakage, IStaffMemberRepository staff, ICurrentBranch branch)
    : IRequestHandler<GetBreakageQuery, IReadOnlyList<BreakageEntryDto>>
{
    public async Task<IReadOnlyList<BreakageEntryDto>> Handle(GetBreakageQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From)
            throw new DomainException("The period ends before it starts.");
        var names = (await staff.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        return (await branch.NarrowAsync(await breakage.GetBetweenAsync(request.From, request.To, cancellationToken), cancellationToken))
            .Select(b => BreakageDtos.Of(b, names)).ToList();
    }
}

// Its id is made by the app, so a retried entry is recorded once.
public sealed record RecordBreakageCommand(
    Guid Id, DateOnly Date, string Description, int Quantity, decimal? UnitCost, Guid? EmployeeId, string? Notes, string StaffName)
    : IRequest<BreakageEntryDto>, IRetryOnConflict, IBooksEntry
{
    IEnumerable<DateOnly?> IBooksEntry.BooksDays => [Date];
}

internal sealed class RecordBreakageHandler(IBreakageEntryRepository breakage, IStaffMemberRepository staff, IBusinessCalendar calendar, IUnitOfWork unitOfWork)
    : IRequestHandler<RecordBreakageCommand, BreakageEntryDto>
{
    public async Task<BreakageEntryDto> Handle(RecordBreakageCommand request, CancellationToken cancellationToken)
    {
        var names = (await staff.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        if (await breakage.GetByIdAsync(request.Id, cancellationToken) is { } already)
            return BreakageDtos.Of(already, names);
        if (request.Date > calendar.BusinessDateOf(DateTime.UtcNow))
            throw new DomainException("Breakage is entered on the day it happened, or after: not before.");
        if (request.EmployeeId is { } who && !names.ContainsKey(who))
            throw new DomainException("That person is not on Staff.");

        var entry = new BreakageEntry(
            request.Id, request.Date, null, null, request.Description, request.Quantity, request.UnitCost, request.EmployeeId, request.Notes, request.StaffName);
        breakage.Add(entry);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return BreakageDtos.Of(entry, names);
    }
}

internal static class BreakageDtos
{
    public static BreakageEntryDto Of(BreakageEntry b, IReadOnlyDictionary<Guid, string> names) => new(
        b.Id, b.BusinessDate, b.AssetItemId, b.AssetTransactionId, b.Description, b.Quantity, b.UnitCost, b.Cost, b.EmployeeId,
        b.EmployeeId is { } e ? names.GetValueOrDefault(e) : null, b.Notes, b.RecordedBy, b.RecordedAtUtc, b.IsVoided);
}
```


- **وجبات العاملين والضيافة وتجارب الوصفات:** ما يخرج من المخزون **عن قصد** ليس هالكًا ولا عجزًا. لكل نوع سبب حركة مستقل (`StaffMeal` و`Hospitality` و`RecipeTasting`، ومجموعتها `StaffConsumption.Reasons`)، فتقرير الاستهلاك والفروقات يخرجه من "غير المبرر" في عمود خاص. السطر إما خامة/مصنع بكميته بوحدته، أو **وصفة بأطباق كاملة** تأخذ مكوناتها كما يأخذها البيع (`RequirementsFor`: المصنعات من مخزونها، لا تُفكّ لخاماتها). و `EntryId` يجعل إعادة الإرسال تسجّل مرة واحدة، والإلغاء بنفس موافقة الهالك (`Deletions.cs` يبحث بسبب الهالك ثم أسباب العاملين ويعكس بسبب أول قيد). وجبة العاملين تذهب لتكلفة العمالة، والضيافة والتجارب لمصروفات مستقلة.

> 📄 **`backend/src/Costing.Application/Waste/StaffMeals.cs`** — 101 سطر

```csharp
using MediatR;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Common;
using Costing.Domain.Menu;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;
using Costing.Application.Books;

namespace Costing.Application.Waste;

// What was taken from stock on purpose (وجبات العاملين والضيافة): a staff meal, hospitality to a
// guest, or a recipe tried. Logged apart from spoilage, so the kitchen is never charged with them
// as unexplained loss, and the P&L carries them where they belong: staff meals in the labor cost,
// hospitality and tastings as costs of their own.
public enum StaffConsumptionKind
{
    StaffMeal = 1,
    Hospitality = 2,
    RecipeTasting = 3,
}

// A line: a material or prep item (Quantity in its own unit: grams, millilitres, pieces), or a
// recipe (Quantity in plates, whole): its ingredients taken as a sale takes them, prep items from
// their own stock, at the average cost now.
public sealed record StaffConsumptionLine(Guid? RawMaterialId, Guid? RecipeId, decimal Quantity);

// EntryId works as a spoilage's: made by the screen, so a retry records it once. RecordedBy is
// set by the API from who is signed in.
public sealed record RecordStaffConsumptionCommand(
    Guid EntryId, StaffConsumptionKind Kind, IReadOnlyList<StaffConsumptionLine> Lines, string? Note = null, string RecordedBy = "")
    : IRequest<Guid>, IRetryOnConflict, IBooksEntry
{
    bool IBooksEntry.WritesToday => true;
}

public static class StaffConsumptionKinds
{
    public static StockMovementReason ReasonOf(StaffConsumptionKind kind) => kind switch
    {
        StaffConsumptionKind.StaffMeal => StockMovementReason.StaffMeal,
        StaffConsumptionKind.Hospitality => StockMovementReason.Hospitality,
        StaffConsumptionKind.RecipeTasting => StockMovementReason.RecipeTasting,
        _ => throw new DomainException("A staff meal, hospitality or a recipe tasting. · وجبة عاملين أو ضيافة أو تجربة وصفة."),
    };
}

internal sealed class RecordStaffConsumptionHandler(
    IRawMaterialRepository materials, IRecipeRepository recipes, IMenuRepository menu, IStockMovementRepository movements, IUnitOfWork unitOfWork)
    : IRequestHandler<RecordStaffConsumptionCommand, Guid>
{
    public async Task<Guid> Handle(RecordStaffConsumptionCommand request, CancellationToken cancellationToken)
    {
        var reason = StaffConsumptionKinds.ReasonOf(request.Kind);
        if (await movements.ExistsAsync(request.EntryId, reason, cancellationToken))
            return request.EntryId;
        if (request.Lines.Count == 0)
            throw new DomainException("Add at least one item. · أضف صنفًا واحدًا على الأقل.");
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note?.Length > 120)
            throw new DomainException("Keep the note under 120 characters.");

        // Each line, as what it takes from stock: (material, quantity, what to call it).
        var taken = new List<(Guid Material, decimal Quantity, string? Note)>();
        IReadOnlyList<MenuItem>? items = null;
        foreach (var line in request.Lines)
        {
            if ((line.RawMaterialId is null) == (line.RecipeId is null))
                throw new DomainException("Each line is a material or a recipe. · كل سطر خامة أو وصفة.");
            if (line.Quantity <= 0)
                throw new DomainException("Each line needs a quantity greater than zero. · الكمية أكبر من صفر.");
            if (line.RawMaterialId is { } materialId)
            {
                taken.Add((materialId, line.Quantity, note));
                continue;
            }

            var recipe = await recipes.GetRequiredAsync(line.RecipeId!.Value, cancellationToken);
            if (recipe.IsDeleted)
                throw new DomainException("That recipe is deleted. · الوصفة محذوفة.");
            if (line.Quantity != decimal.Truncate(line.Quantity))
                throw new DomainException("A recipe is taken in whole plates. · الوصفة بالطبق الكامل.");
            items ??= await menu.GetItemsAsync(cancellationToken);
            var name = recipe.Name
                ?? (recipe.CatalogItemId is { } id ? items.FirstOrDefault(i => i.Id == id)?.Name : null)
                ?? "A recipe";
            var plates = (int)line.Quantity;
            var said = $"{plates} × {name}{(note is null ? "" : $" · {note}")}";
            taken.AddRange(recipe.RequirementsFor(plates).Select(r => (r.RawMaterialId, r.Quantity, (string?)(said.Length > 200 ? said[..200] : said))));
        }

        var byId = await materials.GetRequiredByIdsAsync(taken.Select(t => t.Material).Distinct().ToList(), cancellationToken);
        if (byId.Values.FirstOrDefault(m => m.IsArchived) is { } archived)
            throw new DomainException($"{archived.Name} has been deleted from the raw materials.");
        foreach (var (material, quantity, said) in taken)
            movements.Add(byId[material].RecordConsumption(quantity, request.EntryId, reason, said, request.RecordedBy));
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return request.EntryId;
    }
}
```


## 6. `InventoryController` (`api/inventory`)

أكبر Controller: الخامات والوحدات، الوصفات والمصنعات، أوامر الإنتاج، الجرد، الهالك، الفواتير ويومية المشتريات وتعديلها وصورها، الفئات والمصروفات والموردون، و **طلبات الحذف** (`deletion-requests`). الصلاحيات على كل endpoint (لا تعتمد على السجل)، و `CanApprove` يقرر "200 تنفيذ" أم "202 طلب".

> 📄 **`backend/src/Costing.Api/Controllers/InventoryController.cs`** — 930 سطر

```csharp
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Domain.Access;
using Costing.Application.Approvals;
using Costing.Application.Categories;
using Costing.Application.Expenses;
using Costing.Application.RawMaterials;
using Costing.Application.Production;
using Costing.Application.Purchases;
using Costing.Application.Recipes;
using Costing.Application.StockCounts;
using Costing.Application.Suppliers;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Categories;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Api.Auth;
using Costing.Infrastructure.Excel;

namespace Costing.Api.Controllers;

// Stock and recipes. Unlike orders, who may do what here never depends on the record, so the
// permissions are checked on the endpoints: the Inventory use cases also run from the outbox
// with no user at all, deducting stock for a sale.
//
// Seeing stock is InventoryView (cashiers too); changing it is InventoryManage (managers). The
// sales side moves stock by itself, through OrderSettled and OrderItemsVoided.
[ApiController]
[Route("api/inventory")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class InventoryController(ISender sender) : ControllerBase
{
    [HttpGet("raw-materials")]
    [CostingTab(CostingTabs.All)]
    public Task<IReadOnlyList<RawMaterialDto>> GetRawMaterials([FromQuery] bool needsReorderOnly, CancellationToken cancellationToken) =>
        sender.Send(new GetRawMaterialsQuery(needsReorderOnly), cancellationToken);

    [HttpPost("raw-materials")]
    [CostingTab(CostingTabs.Materials | CostingTabs.Purchases | CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<RawMaterialDto>> CreateRawMaterial(CreateRawMaterialCommand command, CancellationToken cancellationToken)
    {
        var created = await sender.Send(command, cancellationToken);
        return CreatedAtAction(nameof(GetRawMaterials), null, created);
    }

    [HttpPut("raw-materials/{rawMaterialId:guid}")]
    [CostingTab(CostingTabs.Materials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<RawMaterialDto> UpdateRawMaterial(Guid rawMaterialId, UpdateRawMaterialRequest request, CancellationToken cancellationToken) =>
        sender.Send(new UpdateRawMaterialCommand(
            rawMaterialId, request.Name, request.ReorderLevel, request.Code, request.CategoryId,
            request.PurchaseUnit, request.PurchaseUnitSize, request.DefaultYieldPercent, request.CostPerPurchaseUnit), cancellationToken);

    // What records a material (the ledger, invoices, recipes, prep recipes, counts, batches): a
    // change of the unit it is counted in restates them all, and needs the conversion to.
    // Starred, or not, as a daily critical item (جرد يومي سريع): from the materials, the prep items
    // or the counts. A flag; no stock moves, so no approval.
    [HttpPut("raw-materials/{rawMaterialId:guid}/spot-check")]
    [CostingTab(CostingTabs.Materials | CostingTabs.Recipes | CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<object> SetSpotCheckItem(Guid rawMaterialId, SpotCheckRequest request, CancellationToken cancellationToken) =>
        new { isSpotCheckItem = await sender.Send(new SetSpotCheckItemCommand(rawMaterialId, request.IsSpotCheckItem), cancellationToken) };

    [HttpGet("raw-materials/{rawMaterialId:guid}/usage")]
    [CostingTab(CostingTabs.Materials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<MaterialUsage> GetMaterialUsage(Guid rawMaterialId, CancellationToken cancellationToken) =>
        sender.Send(new GetMaterialUsageQuery(rawMaterialId), cancellationToken);

    // The unit a material is counted in changed (عدّ بـ). Nothing recording it: changed at once for
    // anyone (200). Otherwise, with how many of the old unit one of the new is, everything recorded
    // is restated: at once for a manager (200, Applied), asked of one for anyone else (202,
    // Requested). RequestId is made by the till.
    [HttpPost("raw-materials/{rawMaterialId:guid}/unit")]
    [CostingTab(CostingTabs.Materials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<MaterialUnitChangeResult>> ChangeMaterialUnit(
        Guid rawMaterialId, ChangeMaterialUnitRequest request, CancellationToken cancellationToken)
    {
        var result = await sender.Send(new ChangeMaterialUnitCommand(
            request.RequestId, rawMaterialId,
            new MaterialUnitChange(
                request.Unit, request.OneNewIsOld, request.PurchaseUnit, request.PurchaseUnitSize, request.CostPerPurchaseUnit, request.ReorderLevel),
            request.Reason, StaffId, StaffName, CanApprove), cancellationToken);
        return result.Outcome == ApprovalOutcome.Requested ? Accepted(result) : Ok(result);
    }

    // The spreadsheet to bring raw materials in from: the columns, the unit and category lists.
    [HttpGet("raw-materials/template")]
    [CostingTab(CostingTabs.Materials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> GetRawMaterialsTemplate(CancellationToken cancellationToken)
    {
        var sheet = await sender.Send(new GetRawMaterialSheetQuery(), cancellationToken);
        return File(RawMaterialWorkbook.Build(sheet.Categories, sheet.Stations), RawMaterialWorkbook.ContentType, RawMaterialWorkbook.FileName);
    }

    // The raw materials as they are, under the template's columns: edited and imported back, or
    // imported into another installation.
    [HttpGet("raw-materials/export")]
    [CostingTab(CostingTabs.Materials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> ExportRawMaterials(CancellationToken cancellationToken)
    {
        var sheet = await sender.Send(new GetRawMaterialSheetQuery(), cancellationToken);
        return File(RawMaterialWorkbook.Build(sheet.Categories, sheet.Lines, sheet.Stations), RawMaterialWorkbook.ContentType, RawMaterialWorkbook.ExportFileName);
    }

    // A filled-in sheet: each good row a material added or changed, the rest said why not.
    [HttpPost("raw-materials/import")]
    [CostingTab(CostingTabs.Materials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [RequestSizeLimit(MaxImportBytes + 64 * 1024)]
    public async Task<RawMaterialImportResult> ImportRawMaterials(IFormFile file, CancellationToken cancellationToken)
    {
        await using var stream = OpenSheet(file);
        return await sender.Send(new ImportRawMaterialsCommand(RawMaterialWorkbook.Read(stream)), cancellationToken);
    }

    private const int MaxImportBytes = 5 * 1024 * 1024;

    private static Stream OpenSheet(IFormFile file) =>
        file.Length > MaxImportBytes
            ? throw new Costing.Domain.Common.DomainException(
                "The file is larger than 5 MB: a sheet of these is far smaller. Is it the right file? · الملف أكبر من 5 ميجابايت: هل هو الملف الصحيح؟")
            : file.OpenReadStream();

    // Goods received in one request, filed as a posted invoice paid from the safe (waiting for a
    // manager's approval when someone else sends it). PurchaseId is made by the till,
    // so a retry after a lost response books the delivery once, not twice. The screens enter an
    // invoice in two steps instead, below.
    [HttpPost("purchases")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<RawMaterialDto>> ReceivePurchase(ReceivePurchaseCommand command, CancellationToken cancellationToken) =>
        sender.Send(command with { RecordedBy = StaffName, StaffId = StaffId, CanApprove = CanApprove }, cancellationToken);

    // Supplier invoices: posted ones for the history, newest first, or the drafts being entered.
    [HttpGet("purchase-invoices")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<PurchaseInvoiceSummaryDto>> GetPurchaseInvoices(
        [FromQuery] PurchaseInvoiceStatus status = PurchaseInvoiceStatus.Posted, CancellationToken cancellationToken = default) =>
        sender.Send(new GetPurchaseInvoicesQuery(status), cancellationToken);

    [HttpGet("purchase-invoices/{invoiceId:guid}")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<PurchaseInvoiceDto>> GetPurchaseInvoice(Guid invoiceId, CancellationToken cancellationToken) =>
        await sender.Send(new GetPurchaseInvoiceQuery(invoiceId), cancellationToken) is { } invoice ? invoice : NotFound();

    // Step one: the invoice as entered, saved as a draft (created on its first save).
    [HttpPut("purchase-invoices/{invoiceId:guid}")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<PurchaseInvoiceDto> SavePurchaseInvoice(Guid invoiceId, SavePurchaseInvoiceRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SavePurchaseInvoiceCommand(
            invoiceId, request.SupplierId, request.SupplierInvoiceNumber, request.InvoiceDate, request.Lines, StaffName,
            request.PaymentMethod, request.RevenueDate, request.Discount, request.PurchaseOrderId, request.ClosesPurchaseOrder), cancellationToken);

    // Step two, after the review: the stock goes in, and it is paid as chosen: on credit, owed to
    // the supplier; in cash, paid for a manager and waiting for one's approval for anyone else
    // (PaymentStatus says which). Posting again returns the posted invoice.
    [HttpPost("purchase-invoices/{invoiceId:guid}/post")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<PurchaseInvoiceDto> PostPurchaseInvoice(Guid invoiceId, CancellationToken cancellationToken) =>
        sender.Send(new PostPurchaseInvoiceCommand(invoiceId, StaffName, StaffId, CanApprove), cancellationToken);

    // A day's purchases entered together: the date and payment chosen once, an invoice for each
    // supplier, suppliers paid against what they are owed, and employees' advances. Each becomes
    // its own posted invoice or payment, paid as chosen (a manager's at once, anyone else's asked of one); none is saved
    // unless all can be (422, each problem by its invoice or payment).
    [HttpPost("purchase-invoices/batch")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<PurchaseBatchResult> PostPurchaseBatch(PurchaseBatchRequest request, CancellationToken cancellationToken) =>
        sender.Send(new PostPurchaseBatchCommand(
            request.InvoiceDate, request.PaymentMethod, request.RevenueDate, request.Invoices, StaffName, StaffId, CanApprove, request.Payments ?? [],
            request.Advances ?? []),
            cancellationToken);

    // A posted invoice corrected (تعديل فاتورة): voided and posted again as it should have been, as a
    // new invoice naming it. Done at once for a manager (200, Applied); asked of one for anyone else
    // (202, Requested), the invoice as it was, and locked, until then. RequestId and NewInvoiceId are
    // made by the till.
    [HttpPost("purchase-invoices/{invoiceId:guid}/correct")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<ApprovalResultDto>> CorrectPurchaseInvoice(
        Guid invoiceId, CorrectPurchaseInvoiceRequest request, CancellationToken cancellationToken)
    {
        var result = await sender.Send(new CorrectPurchaseInvoiceCommand(
            request.RequestId, invoiceId,
            new InvoiceCorrection(
                request.NewInvoiceId, request.SupplierId, request.SupplierInvoiceNumber, request.InvoiceDate, request.Lines, request.PaymentMethod,
                request.RevenueDate, request.Discount),
            request.Reason, StaffId, StaffName, CanApprove), cancellationToken);
        return result.Outcome == ApprovalOutcome.Requested ? Accepted(result) : Ok(result);
    }

    // What a correction would change, checked as it will be when sent; nothing is saved.
    [HttpPost("purchase-invoices/{invoiceId:guid}/correct/preview")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<InvoiceCorrectionPreview> PreviewInvoiceCorrection(Guid invoiceId, CorrectPurchaseInvoiceRequest request, CancellationToken cancellationToken) =>
        sender.Send(new PreviewInvoiceCorrectionQuery(
            invoiceId,
            new InvoiceCorrection(
                request.NewInvoiceId, request.SupplierId, request.SupplierInvoiceNumber, request.InvoiceDate, request.Lines, request.PaymentMethod,
                request.RevenueDate, request.Discount),
            StaffName), cancellationToken);

    // Pays a posted cash invoice that is not paid (its payment was rejected or voided), or puts it
    // on credit. RequestId is made by the till.
    [HttpPost("purchase-invoices/{invoiceId:guid}/pay")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<object> PayPurchaseInvoice(Guid invoiceId, PayPurchaseInvoiceRequest request, CancellationToken cancellationToken) =>
        new
        {
            PaymentStatus = await sender.Send(new PayPurchaseInvoiceCommand(
                request.RequestId, invoiceId, request.Method, request.RevenueDate, StaffId, StaffName, CanApprove), cancellationToken),
        };

    [HttpDelete("purchase-invoices/{invoiceId:guid}")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> DiscardPurchaseInvoice(Guid invoiceId, CancellationToken cancellationToken)
    {
        await sender.Send(new DiscardPurchaseInvoiceCommand(invoiceId), cancellationToken);
        return NoContent();
    }

    // The paper, photographed or scanned: a JPEG, PNG, WebP or PDF of up to 10 MB.
    [HttpPut("purchase-invoices/{invoiceId:guid}/attachment")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [RequestSizeLimit(PurchaseInvoice.MaxAttachmentBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = PurchaseInvoice.MaxAttachmentBytes + 64 * 1024)]
    public async Task<ActionResult<PurchaseInvoiceDto>> AttachPurchaseInvoiceFile(Guid invoiceId, IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > PurchaseInvoice.MaxAttachmentBytes)
            return UnprocessableEntity(new { errors = new[] { "The file must be under 10 MB." } });
        using var content = new MemoryStream();
        await file.CopyToAsync(content, cancellationToken);
        return await sender.Send(new AttachPurchaseInvoiceFileCommand(invoiceId, file.FileName, file.ContentType, content.ToArray(), StaffName), cancellationToken);
    }

    [HttpGet("purchase-invoices/{invoiceId:guid}/attachment")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> GetPurchaseInvoiceFile(Guid invoiceId, [FromQuery] bool download, CancellationToken cancellationToken)
    {
        if (await sender.Send(new GetPurchaseInvoiceAttachmentQuery(invoiceId), cancellationToken) is not { } attached)
            return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        return download ? File(attached.Content, attached.ContentType, attached.FileName) : File(attached.Content, attached.ContentType);
    }

    // The suppliers, by name; the archived ones too when asked for. The end of the day hands its
    // invoices in under them.
    [HttpGet("suppliers")]
    [CostingTab(CostingTabs.Purchases | CostingTabs.Financials | CostingTabs.EndOfDay)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<SupplierDto>> GetSuppliers([FromQuery] bool includeArchived, CancellationToken cancellationToken) =>
        sender.Send(new GetSuppliersQuery(includeArchived), cancellationToken);

    // Adds the supplier on the first save, under the id the till made; changes it after.
    [HttpPut("suppliers/{supplierId:guid}")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SupplierDto> SaveSupplier(Guid supplierId, SaveSupplierRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveSupplierCommand(
            supplierId, request.Name, request.ContactPerson, request.Phone, request.Email, request.Notes, request.PaymentTermsDays), cancellationToken);

    // Deleted if it is on no invoice, archived if it is: the answer says which.
    [HttpDelete("suppliers/{supplierId:guid}")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SupplierRemovalDto> DeleteSupplier(Guid supplierId, CancellationToken cancellationToken) =>
        sender.Send(new DeleteSupplierCommand(supplierId), cancellationToken);

    [HttpPost("suppliers/{supplierId:guid}/restore")]
    [CostingTab(CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<SupplierDto> RestoreSupplier(Guid supplierId, CancellationToken cancellationToken) =>
        sender.Send(new RestoreSupplierCommand(supplierId), cancellationToken);

    // The purchase categories materials and expense items are filed under, General first, with
    // how much is in each. Anyone who sees stock sees how it is grouped.
    [HttpGet("purchase-categories")]
    [CostingTab(CostingTabs.Materials | CostingTabs.ExpenseItems | CostingTabs.Purchases | CostingTabs.Reports)]
    public Task<IReadOnlyList<PurchaseCategoryDto>> GetPurchaseCategories(CancellationToken cancellationToken) =>
        sender.Send(new GetPurchaseCategoriesQuery(), cancellationToken);

    // Adds it on the first save, under the id the till made; changes it after.
    [HttpPut("purchase-categories/{categoryId:guid}")]
    [CostingTab(CostingTabs.Materials | CostingTabs.ExpenseItems | CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<PurchaseCategoryDto> SavePurchaseCategory(Guid categoryId, SavePurchaseCategoryRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SavePurchaseCategoryCommand(
            categoryId, request.Name, request.NameAr, request.ExpenseLine ?? ExpenseLine.Controllable, request.Kind), cancellationToken);

    // moveTo: where what is in it goes, as it is; required while it holds anything. One that would
    // be converted on the way (the other kind of category) is refused: that is POST .../delete.
    [HttpDelete("purchase-categories/{categoryId:guid}")]
    [CostingTab(CostingTabs.Materials | CostingTabs.ExpenseItems | CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> DeletePurchaseCategory(Guid categoryId, [FromQuery] Guid? moveTo, CancellationToken cancellationToken)
    {
        await sender.Send(new DeletePurchaseCategoryCommand(categoryId, moveTo, moveTo, AllowConversion: false), cancellationToken);
        return NoContent();
    }

    // Deleted, its raw materials moved to MaterialsTo and its expense items to ExpenseItemsTo; a
    // kind sent to the other kind of category is converted on the way: raw materials made expense
    // items (their purchases restated as expenses), or expense items made raw materials (Units:
    // what each is counted in and bought by). Done at once for a manager, or when nothing is
    // converted (200, Applied); asked of one for anyone else (202, Requested). RequestId is made by
    // the till.
    [HttpPost("purchase-categories/{categoryId:guid}/delete")]
    [CostingTab(CostingTabs.Materials | CostingTabs.ExpenseItems | CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<CategoryDeletionResult>> DeletePurchaseCategoryConverting(
        Guid categoryId, DeletePurchaseCategoryRequest request, CancellationToken cancellationToken)
    {
        var result = await sender.Send(new DeletePurchaseCategoryCommand(
            categoryId, request.MaterialsTo, request.ExpenseItemsTo, request.Units ?? [], request.RequestId, request.Reason, StaffId, StaffName, CanApprove),
            cancellationToken);
        return result.Outcome == ApprovalOutcome.Requested ? Accepted(result) : Ok(result);
    }

    // What deleting it would do, checked as it will be when sent; nothing is saved.
    [HttpPost("purchase-categories/{categoryId:guid}/delete/preview")]
    [CostingTab(CostingTabs.Materials | CostingTabs.ExpenseItems | CostingTabs.Purchases)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<CategoryDeletionPreview> PreviewPurchaseCategoryDeletion(
        Guid categoryId, DeletePurchaseCategoryRequest request, CancellationToken cancellationToken) =>
        sender.Send(new PreviewCategoryDeletionQuery(categoryId, request.MaterialsTo, request.ExpenseItemsTo, request.Units ?? []), cancellationToken);

    // Expense items: bought but never stock. A manager's, as what they cost is on them.
    [HttpGet("expense-items")]
    [CostingTab(CostingTabs.ExpenseItems | CostingTabs.Purchases | CostingTabs.Financials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<ExpenseItemDto>> GetExpenseItems([FromQuery] bool includeArchived, CancellationToken cancellationToken) =>
        sender.Send(new GetExpenseItemsQuery(includeArchived), cancellationToken);

    // The expense items to and from a spreadsheet, as the raw materials are.
    [HttpGet("expense-items/template")]
    [CostingTab(CostingTabs.ExpenseItems)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> GetExpenseItemsTemplate(CancellationToken cancellationToken)
    {
        var sheet = await sender.Send(new GetExpenseItemSheetQuery(), cancellationToken);
        return File(ExpenseItemWorkbook.Build(sheet.Categories), ExpenseItemWorkbook.ContentType, ExpenseItemWorkbook.FileName);
    }

    [HttpGet("expense-items/export")]
    [CostingTab(CostingTabs.ExpenseItems)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> ExportExpenseItems(CancellationToken cancellationToken)
    {
        var sheet = await sender.Send(new GetExpenseItemSheetQuery(), cancellationToken);
        return File(ExpenseItemWorkbook.Build(sheet.Categories, sheet.Lines), ExpenseItemWorkbook.ContentType, ExpenseItemWorkbook.ExportFileName);
    }

    [HttpPost("expense-items/import")]
    [CostingTab(CostingTabs.ExpenseItems)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [RequestSizeLimit(MaxImportBytes + 64 * 1024)]
    public async Task<ExpenseItemImportResult> ImportExpenseItems(IFormFile file, CancellationToken cancellationToken)
    {
        await using var stream = OpenSheet(file);
        return await sender.Send(new ImportExpenseItemsCommand(ExpenseItemWorkbook.Read(stream)), cancellationToken);
    }

    [HttpPut("expense-items/{expenseItemId:guid}")]
    [CostingTab(CostingTabs.ExpenseItems)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<ExpenseItemDto> SaveExpenseItem(Guid expenseItemId, SaveExpenseItemRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveExpenseItemCommand(expenseItemId, request.Name, request.CategoryId, request.NameAr, request.Unit), cancellationToken);

    [HttpDelete("expense-items/{expenseItemId:guid}")]
    [CostingTab(CostingTabs.ExpenseItems)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<ExpenseItemRemovalDto> DeleteExpenseItem(Guid expenseItemId, CancellationToken cancellationToken) =>
        sender.Send(new DeleteExpenseItemCommand(expenseItemId), cancellationToken);

    [HttpPost("expense-items/{expenseItemId:guid}/restore")]
    [CostingTab(CostingTabs.ExpenseItems)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<ExpenseItemDto> RestoreExpenseItem(Guid expenseItemId, CancellationToken cancellationToken) =>
        sender.Send(new RestoreExpenseItemCommand(expenseItemId), cancellationToken);

    // Prep items: made in the kitchen, kept in stock, costed from their batches. Seen by whoever
    // keeps the books; added and changed by a manager at once (200, the prep item), and by anyone
    // else as a request a manager approves (202, the request), nothing changed until then.
    [HttpGet("prep-items")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Production | CostingTabs.Counts | CostingTabs.Waste)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<PrepItemDto>> GetPrepItems(CancellationToken cancellationToken) =>
        sender.Send(new GetPrepItemsQuery(), cancellationToken);

    [HttpGet("prep-items/{prepItemId:guid}")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Production | CostingTabs.Counts | CostingTabs.Waste)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<PrepItemDto>> GetPrepItem(Guid prepItemId, CancellationToken cancellationToken) =>
        await sender.Send(new GetPrepItemQuery(prepItemId), cancellationToken) is { } item ? item : NotFound();

    [HttpPost("prep-items")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IActionResult> CreatePrepItem(SavePrepItemRequest request, CancellationToken cancellationToken) =>
        SavePrepItem(null, request, cancellationToken);

    [HttpPut("prep-items/{prepItemId:guid}")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IActionResult> UpdatePrepItem(Guid prepItemId, SavePrepItemRequest request, CancellationToken cancellationToken) =>
        SavePrepItem(prepItemId, request, cancellationToken);

    // A sheet of batch recipes (المصنعات): each prep item named on a row of its own, then its
    // ingredients. Made at once for a manager; asked of one, item by item, for anyone else.
    [HttpPost("prep-items/import")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [RequestSizeLimit(MaxImportBytes + 64 * 1024)]
    public async Task<PrepImportResult> ImportPrepItems(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > MaxImportBytes)
            throw new Costing.Domain.Common.DomainException("The file is larger than 5 MB: a sheet of recipes is far smaller. Is it the right file?");
        await using var stream = file.OpenReadStream();
        return await sender.Send(new ImportPrepItemsCommand(PrepItemWorkbook.Read(stream), StaffId, StaffName, CanApprove), cancellationToken);
    }

    // Recipes and prep items to and from a spreadsheet: a row per ingredient, chosen from a
    // dropdown of the materials and prep items with their units. The template is the export with
    // no rows. A recipe's rows replace its ingredients; anyone with Recipes may import recipes,
    // and prep items are saved for a manager and asked of one for anyone else.
    [HttpGet("recipes/sheet/template")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> GetRecipesTemplate(CancellationToken cancellationToken) =>
        File(RecipeWorkbook.Build(await sender.Send(new GetRecipeSheetQuery(), cancellationToken), withRows: false), RecipeWorkbook.ContentType, RecipeWorkbook.FileName);

    [HttpGet("recipes/sheet/export")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> ExportRecipes(CancellationToken cancellationToken) =>
        File(RecipeWorkbook.Build(await sender.Send(new GetRecipeSheetQuery(), cancellationToken), withRows: true), RecipeWorkbook.ContentType, RecipeWorkbook.ExportFileName);

    [HttpPost("recipes/sheet/import")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [RequestSizeLimit(MaxImportBytes + 64 * 1024)]
    public async Task<RecipeImportResult> ImportRecipes(IFormFile file, CancellationToken cancellationToken)
    {
        await using var stream = OpenSheet(file);
        return await sender.Send(new ImportRecipesCommand(RecipeWorkbook.Read(stream)), cancellationToken);
    }

    [HttpGet("prep-items/sheet/template")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> GetPrepItemsTemplate(CancellationToken cancellationToken) =>
        File(PrepRecipeWorkbook.Build(await sender.Send(new GetPrepRecipeSheetQuery(), cancellationToken), withRows: false), PrepRecipeWorkbook.ContentType,
            PrepRecipeWorkbook.FileName);

    [HttpGet("prep-items/sheet/export")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> ExportPrepItems(CancellationToken cancellationToken) =>
        File(PrepRecipeWorkbook.Build(await sender.Send(new GetPrepRecipeSheetQuery(), cancellationToken), withRows: true), PrepRecipeWorkbook.ContentType,
            PrepRecipeWorkbook.ExportFileName);

    [HttpPost("prep-items/sheet/import")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [RequestSizeLimit(MaxImportBytes + 64 * 1024)]
    public async Task<RecipeImportResult> ImportPrepItemsSheet(IFormFile file, CancellationToken cancellationToken)
    {
        await using var stream = OpenSheet(file);
        return await sender.Send(new ImportPrepRecipesCommand(PrepRecipeWorkbook.Read(stream), StaffId, StaffName, CanApprove), cancellationToken);
    }

    private async Task<IActionResult> SavePrepItem(Guid? prepItemId, SavePrepItemRequest request, CancellationToken cancellationToken)
    {
        var command = request.ToCommand(prepItemId);
        if (CanApprove)
            return Ok(await sender.Send(command, cancellationToken));
        return Accepted(await sender.Send(new RequestPrepItemChangeCommand(
            request.RequestId ?? Guid.NewGuid(), prepItemId, command.Change, request.Reason, StaffId, StaffName), cancellationToken));
    }

    // What a batch would take and cost made now: the review before posting.
    [HttpGet("production-orders/preview")]
    [CostingTab(CostingTabs.Production)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<ProductionPreviewDto> PreviewProduction(
        [FromQuery] Guid prepItemId, [FromQuery] decimal planned, [FromQuery] decimal? produced, CancellationToken cancellationToken) =>
        sender.Send(new PreviewProductionQuery(prepItemId, planned, produced), cancellationToken);

    [HttpGet("production-orders")]
    [CostingTab(CostingTabs.Production)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<ProductionOrderDto>> GetProductionOrders([FromQuery] Guid? prepItemId, CancellationToken cancellationToken) =>
        sender.Send(new GetProductionOrdersQuery(prepItemId), cancellationToken);

    [HttpGet("production-orders/{orderId:guid}")]
    [CostingTab(CostingTabs.Production)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<ProductionOrderDto>> GetProductionOrder(Guid orderId, CancellationToken cancellationToken) =>
        await sender.Send(new GetProductionOrderQuery(orderId), cancellationToken) is { } order ? order : NotFound();

    // Makes the batch under the id the till made: the ingredients out, the prep item in, for a
    // manager (200, the batch). Anyone else's is a request (202), and nothing moves until a
    // manager approves it, at the averages then. A retry returns the batch, or request, already made.
    [HttpPut("production-orders/{orderId:guid}")]
    [CostingTab(CostingTabs.Production)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> MakeProductionOrder(Guid orderId, MakeProductionOrderRequest request, CancellationToken cancellationToken)
    {
        if (CanApprove)
            return Ok(await sender.Send(new MakeProductionOrderCommand(
                orderId, request.PrepItemId, request.PlannedQuantity, request.ProducedQuantity, request.Notes, StaffName), cancellationToken));
        return Accepted(await sender.Send(new RequestProductionOrderCommand(
            request.RequestId ?? Guid.NewGuid(), orderId, request.PrepItemId, request.PlannedQuantity, request.ProducedQuantity, request.Notes,
            request.Reason, StaffId, StaffName), cancellationToken));
    }

    // Corrects a batch: reversed and made again with these quantities, at the averages now, as
    // the batch NewOrderId. At once for a manager (200), recorded with the approvals; a request
    // for anyone else (202).
    [HttpPost("production-orders/{orderId:guid}/revision")]
    [CostingTab(CostingTabs.Production)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> ReviseProductionOrder(Guid orderId, ReviseProductionOrderRequest request, CancellationToken cancellationToken)
    {
        var result = await sender.Send(new ReviseProductionOrderCommand(
            request.RequestId, orderId, request.NewOrderId, request.PlannedQuantity, request.ProducedQuantity, request.Notes, request.Reason,
            StaffId, StaffName, CanApprove), cancellationToken);
        return result.Outcome == ApprovalOutcome.Requested ? Accepted(result) : Ok(result);
    }

    // Staff meals, hospitality and recipe tastings (وجبات العاملين والضيافة): taken on purpose, kept
    // apart from spoilage. A recipe's plates take its ingredients as a sale does. EntryId makes a
    // retry harmless; voided like a waste entry, through Waste's approvals.
    [HttpPost("staff-meals")]
    [CostingTab(CostingTabs.Waste)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<object> RecordStaffMeal(Costing.Application.Waste.RecordStaffConsumptionCommand command, CancellationToken cancellationToken) =>
        new { entryId = await sender.Send(command with { RecordedBy = StaffName }, cancellationToken) };

    // Thrown-away raw stock: expired, spoiled, dropped. SpoilageId makes a retry harmless.
    [HttpPost("spoilage")]
    [CostingTab(CostingTabs.Waste)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<RawMaterialDto>> RecordSpoilage(RecordSpoilageCommand command, CancellationToken cancellationToken) =>
        sender.Send(command with { RecordedBy = StaffName }, cancellationToken);

    // A whole physical count in one request, recorded and posted at once: sets stock to what is
    // on the shelf and records the difference. StockCountId makes a retry harmless, as PurchaseId
    // does above. The screens fill in a draft instead, below.
    // Counted and posted at once: posting is for who sees the records (costing.view).
    [HttpPost("stock-counts")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [Authorize(Policy = Permissions.CostingView)]
    public Task<IReadOnlyList<RawMaterialDto>> RecordStockCount(RecordStockCountCommand command, CancellationToken cancellationToken) =>
        sender.Send(command with { StaffName = StaffName }, cancellationToken);

    // Counts are a manager's: a count sheet shows what is on the shelves, and a posted one what the
    // records expected.
    [HttpGet("stock-counts")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<StockCountSummaryDto>> GetStockCounts(CancellationToken cancellationToken) =>
        sender.Send(new GetStockCountsQuery(), cancellationToken);

    // A count as its caller may see it. Blind (الجرد الأعمى) for whoever does not see the costs (a
    // storekeeper): the records' figures and the costs left out, whatever is asked; anyone else
    // counting blind asks for it (?blind=true).
    [HttpGet("stock-counts/{stockCountId:guid}")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<StockCountDto>> GetStockCount(Guid stockCountId, [FromQuery] bool blind, CancellationToken cancellationToken) =>
        await sender.Send(new GetStockCountQuery(stockCountId, Blind(blind)), cancellationToken) is { } count ? count : NotFound();

    // What a count sheet lists, every material and prep item, with nothing of its stock or cost.
    [HttpGet("stock-counts/items")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<CountItemDto>> GetCountItems(CancellationToken cancellationToken) =>
        sender.Send(new GetCountItemsQuery(), cancellationToken);

    // Saves the draft as it stands, creating it on the first save. The whole list each time: a
    // material left out is not counted. A spot count is started with what it covers.
    [HttpPut("stock-counts/{stockCountId:guid}")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StockCountDto> SaveStockCount(Guid stockCountId, SaveStockCountRequest request, [FromQuery] bool blind, CancellationToken cancellationToken) =>
        sender.Send(new SaveStockCountCommand(
            stockCountId, request.Lines ?? [], StaffName, request.Kind, request.Scope, request.ScopeMaterialIds, request.ScopeLabel, Blind(blind)), cancellationToken);

    // Handed in for review by its counter: anyone who counts may.
    [HttpPost("stock-counts/{stockCountId:guid}/submit")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StockCountDto> SubmitStockCount(Guid stockCountId, [FromQuery] bool blind, CancellationToken cancellationToken) =>
        sender.Send(new SubmitStockCountCommand(stockCountId, StaffName, Blind(blind)), cancellationToken);

    // Lines sent back to be weighed again: by who reconciles, so who sees the records.
    [HttpPost("stock-counts/{stockCountId:guid}/recount")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [Authorize(Policy = Permissions.CostingView)]
    public Task<StockCountDto> RequestRecount(Guid stockCountId, StockCountRecountRequest request, CancellationToken cancellationToken) =>
        sender.Send(new RequestStockCountRecountCommand(stockCountId, request.RawMaterialIds ?? [], request.Note, StaffName), cancellationToken);

    // Sets stock to what was counted, by who has reconciled it against the records (costing.view):
    // a counter who counts blind hands it in instead. Posting again returns the posted count.
    [HttpPost("stock-counts/{stockCountId:guid}/post")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    [Authorize(Policy = Permissions.CostingView)]
    public Task<StockCountDto> PostStockCount(Guid stockCountId, CancellationToken cancellationToken) =>
        sender.Send(new PostStockCountCommand(stockCountId, StaffName), cancellationToken);

    // Discards a draft. A posted count cannot be removed.
    [HttpDelete("stock-counts/{stockCountId:guid}")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> DiscardStockCount(Guid stockCountId, CancellationToken cancellationToken)
    {
        await sender.Send(new DiscardStockCountCommand(stockCountId), cancellationToken);
        return NoContent();
    }

    // A menu item's, variant's or add-on's recipe. 404 means it has none yet, and only 404:
    // the till must not show an empty recipe for a request that merely failed.
    [HttpGet("recipes")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu)]
    public async Task<ActionResult<RecipeDto>> GetRecipe(
        [FromQuery] RecipeTargetKind targetKind, [FromQuery] int catalogItemId, [FromQuery] int? variantId, CancellationToken cancellationToken)
    {
        var recipe = await sender.Send(new GetRecipeQuery(targetKind, catalogItemId, variantId), cancellationToken);
        return recipe is null ? NotFound() : recipe;
    }

    // Replaces the recipe a menu item sells by, whole. No ingredients deletes it (it is kept,
    // marked deleted), answered with 204.
    [HttpPut("recipes")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<RecipeDto>> SetRecipe(SetRecipeCommand command, CancellationToken cancellationToken)
    {
        var recipe = await sender.Send(command with { StaffName = StaffName, CanDelete = CanApprove }, cancellationToken);
        return recipe is null ? NoContent() : recipe;
    }

    // A recipe of its own: linked to a menu item, or off the menu (no target).
    [HttpPost("recipes")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<RecipeDto> CreateRecipe(SaveRecipeRequest request, CancellationToken cancellationToken) =>
        sender.Send(request.ToCommand(null), cancellationToken);

    [HttpPut("recipes/{recipeId:guid}")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<RecipeDto> UpdateRecipe(Guid recipeId, SaveRecipeRequest request, CancellationToken cancellationToken) =>
        sender.Send(request.ToCommand(recipeId), cancellationToken);

    // The kitchen's recipe categories, with how many recipes each holds.
    [HttpGet("recipe-categories")]
    [CostingTab(CostingTabs.Recipes | CostingTabs.Menu)]
    public Task<IReadOnlyList<RecipeCategoryDto>> GetRecipeCategories(CancellationToken cancellationToken) =>
        sender.Send(new GetRecipeCategoriesQuery(), cancellationToken);

    // Adds it on the first save, under the id the till made; renames it after.
    [HttpPut("recipe-categories/{categoryId:guid}")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<RecipeCategoryDto> SaveRecipeCategory(Guid categoryId, SaveRecipeCategoryRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveRecipeCategoryCommand(categoryId, request.Name, request.NameAr), cancellationToken);

    // moveTo: where its recipes go; required while it has any.
    [HttpDelete("recipe-categories/{categoryId:guid}")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> DeleteRecipeCategory(Guid categoryId, [FromQuery] Guid? moveTo, CancellationToken cancellationToken)
    {
        await sender.Send(new DeleteRecipeCategoryCommand(categoryId, moveTo), cancellationToken);
        return NoContent();
    }

    // A combo offer (عرض مجمع) added or changed: its dishes, its price and code, and its menu item
    // with it. For whoever writes recipes.
    [HttpPut("combos/{comboId:guid}")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<Costing.Application.Menu.ComboOfferSaved> SaveCombo(Guid comboId, SaveComboRequest request, CancellationToken cancellationToken) =>
        sender.Send(new Costing.Application.Menu.SaveComboOfferCommand(
            comboId, request.Code, request.Name, request.NameAr, request.SellingPrice, request.IsActive, request.Items ?? []), cancellationToken);

    // Off the menu and the list; its sales keep it.
    [HttpDelete("combos/{comboId:guid}")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> DeleteCombo(Guid comboId, CancellationToken cancellationToken)
    {
        await sender.Send(new Costing.Application.Menu.DeleteComboOfferCommand(comboId, StaffName), cancellationToken);
        return NoContent();
    }

    // Marks it deleted: kept for the record, gone from the screens and the sales.
    // Deleted (204) by someone who may approve deletions; asked of a manager otherwise (202).
    [HttpDelete("recipes/{recipeId:guid}")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> DeleteRecipe(Guid recipeId, CancellationToken cancellationToken)
    {
        var result = await sender.Send(DeletionOf(Guid.NewGuid(), ApprovalModule.Recipe, recipeId, null), cancellationToken);
        return result.Outcome == ApprovalOutcome.Applied ? NoContent() : Accepted(result);
    }

    // Deletes a recipe, raw material, posted invoice, waste entry, posted stock count, prep item
    // or production order: at once (200, Applied) for someone who may approve, otherwise asked of
    // a manager (202, Requested), the record left as it is until then. RequestId is made by the till.
    [HttpPost("deletion-requests")]
    [CostingTab(CostingTabs.All)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<ApprovalResultDto>> RequestDeletion(RequestDeletionBody request, CancellationToken cancellationToken)
    {
        var result = await sender.Send(DeletionOf(request.RequestId, request.Module, request.RecordId, request.Reason), cancellationToken);
        return result.Outcome == ApprovalOutcome.Requested ? Accepted(result) : Ok(result);
    }

    // What waits for a manager (deletions, new and changed prep items and batches), for the
    // screens to mark and lock; with ?decided=, the last decisions too, for whoever decides them.
    [HttpGet("approval-requests")]
    [CostingTab(CostingTabs.All)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<ApprovalRequestsDto> GetApprovalRequests([FromQuery] int decided, CancellationToken cancellationToken) =>
        sender.Send(new GetApprovalRequestsQuery(CanApprove ? Math.Clamp(decided, 0, 200) : 0), cancellationToken);

    // What approving a batch would move now, at today's averages, and for a correction the batch
    // it replaces: what the manager signs off on.
    [HttpGet("approval-requests/{requestId:guid}/preview")]
    [CostingTab(CostingTabs.All)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<ApprovalPreviewDto>> GetApprovalPreview(Guid requestId, CancellationToken cancellationToken) =>
        await sender.Send(new GetApprovalPreviewQuery(requestId), cancellationToken) is { } preview ? preview : NotFound();

    [HttpPost("approval-requests/{requestId:guid}/approve")]
    [CostingTab(CostingTabs.All)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<ApprovalRequestDto> ApproveRequest(Guid requestId, CancellationToken cancellationToken) =>
        sender.Send(new ApproveRequestCommand(requestId, StaffName, StaffId), cancellationToken);

    [HttpPost("approval-requests/{requestId:guid}/reject")]
    [CostingTab(CostingTabs.All)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<ApprovalRequestDto> RejectRequest(Guid requestId, RejectRequestBody request, CancellationToken cancellationToken) =>
        sender.Send(new RejectRequestCommand(requestId, request.Note, StaffName), cancellationToken);

    // Name: what to call it if its menu item has another recipe now and it comes back off the menu.
    [HttpPost("recipes/{recipeId:guid}/restore")]
    [CostingTab(CostingTabs.Recipes)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<RecipeDto> RestoreRecipe(Guid recipeId, RestoreRecipeRequest? request, CancellationToken cancellationToken) =>
        sender.Send(new RestoreRecipeCommand(recipeId, request?.Name), cancellationToken);

    // Who is signed in, as their name: kept on counts and spoilage, which have no order to audit them.
    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;

    private bool CanApprove => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide);

    // Counts blind: who does not see the costs always, anyone else when they ask.
    private bool Blind(bool asked) => asked || !(UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.CostingView));

    private string StaffId => UserClaims.IdOf(User) ?? string.Empty;

    private RequestDeletionCommand DeletionOf(Guid requestId, ApprovalModule module, Guid recordId, string? reason) =>
        new(requestId, module, recordId, reason, StaffId, StaffName, CanApprove);
}

public sealed record SaveComboRequest(
    int Code, string Name, string? NameAr, decimal SellingPrice, bool IsActive, IReadOnlyList<Costing.Application.Menu.ComboItemInput>? Items);

// Kind: periodic or opening stock; none keeps the draft's (a new one is periodic).
public sealed record SaveStockCountRequest(
    IReadOnlyList<StockCountLine> Lines,
    Costing.Domain.StockCounts.StockCountKind? Kind = null,
    Costing.Domain.StockCounts.StockCountScope? Scope = null,
    IReadOnlyList<Guid>? ScopeMaterialIds = null,
    string? ScopeLabel = null);

public sealed record StockCountRecountRequest(IReadOnlyList<Guid> RawMaterialIds, string? Note = null);

public sealed record SpotCheckRequest(bool IsSpotCheckItem);

public sealed record CorrectPurchaseInvoiceRequest(
    Guid RequestId,
    Guid NewInvoiceId,
    Guid? SupplierId,
    string? SupplierInvoiceNumber,
    DateOnly? InvoiceDate,
    IReadOnlyList<PurchaseInvoiceLineEntry> Lines,
    PurchasePaymentMethod? PaymentMethod,
    DateOnly? RevenueDate = null,
    string? Reason = null,
    decimal Discount = 0);

public sealed record SavePurchaseInvoiceRequest(
    Guid? SupplierId,
    string? SupplierInvoiceNumber,
    DateOnly? InvoiceDate,
    IReadOnlyList<PurchaseInvoiceLineEntry> Lines,
    PurchasePaymentMethod? PaymentMethod = null,
    DateOnly? RevenueDate = null,
    decimal Discount = 0,
    // The purchase order it delivers, and whether it closes it with what came.
    Guid? PurchaseOrderId = null,
    bool ClosesPurchaseOrder = false);

public sealed record PayPurchaseInvoiceRequest(Guid RequestId, PurchasePaymentMethod Method, DateOnly? RevenueDate = null);

public sealed record PurchaseBatchRequest(
    DateOnly InvoiceDate, PurchasePaymentMethod PaymentMethod, IReadOnlyList<BatchInvoice> Invoices, DateOnly? RevenueDate = null,
    IReadOnlyList<BatchPayment>? Payments = null, IReadOnlyList<BatchAdvance>? Advances = null);

public sealed record SavePrepItemRequest(
    string Name,
    UnitOfMeasure Unit,
    decimal BatchQuantity,
    IReadOnlyList<PrepIngredientEntry> Ingredients,
    string? Code = null,
    Guid? CategoryId = null,
    string? DisplayUnit = null,
    decimal? DisplayUnitSize = null,
    decimal ReorderLevel = 0,
    // For a request: made by the till, so a retry is recorded once; and why, for the manager.
    Guid? RequestId = null,
    string? Reason = null,
    Guid? RecipeCategoryId = null,
    // A batch's prep time (null: the ordinary 10 minutes) and complexity, sent together: without
    // the complexity, neither changes.
    decimal? PrepTimeMinutes = null,
    decimal? ComplexityWeight = null)
{
    public SavePrepItemCommand ToCommand(Guid? id) =>
        new(id, Name, Unit, BatchQuantity, Ingredients ?? [], Code, CategoryId, DisplayUnit, DisplayUnitSize, ReorderLevel, RecipeCategoryId,
            ComplexityWeight is { } weight ? new PlateActivity(PrepTimeMinutes, weight) : null);
}

public sealed record SaveRecipeRequest(
    string? Name,
    RecipeTargetKind? TargetKind,
    int? CatalogItemId,
    int? VariantId,
    int Portions,
    IReadOnlyList<RecipeIngredientDto> Ingredients,
    Guid? RecipeCategoryId = null,
    decimal? PlannedPrice = null,
    // The prep time for one plate (null: the ordinary 10 minutes) and its complexity, sent
    // together: without the complexity, neither changes.
    decimal? PrepTimeMinutes = null,
    decimal? ComplexityWeight = null)
{
    public SaveRecipeCommand ToCommand(Guid? id) =>
        new(id, Name, TargetKind, CatalogItemId, VariantId, Portions, Ingredients ?? [], RecipeCategoryId, PlannedPrice,
            ComplexityWeight is { } weight ? new PlateActivity(PrepTimeMinutes, weight) : null);
}

public sealed record SaveRecipeCategoryRequest(string Name, string? NameAr = null);

public sealed record RestoreRecipeRequest(string? Name);

public sealed record MakeProductionOrderRequest(
    Guid PrepItemId, decimal PlannedQuantity, decimal ProducedQuantity, string? Notes = null, Guid? RequestId = null, string? Reason = null);

public sealed record ReviseProductionOrderRequest(
    Guid RequestId, Guid NewOrderId, decimal PlannedQuantity, decimal ProducedQuantity, string? Notes = null, string? Reason = null);

public sealed record RequestDeletionBody(Guid RequestId, ApprovalModule Module, Guid RecordId, string? Reason = null);

public sealed record RejectRequestBody(string? Note = null);

// PaymentTermsDays: none keeps them as they are.
public sealed record SaveSupplierRequest(
    string Name, string? ContactPerson = null, string? Phone = null, string? Email = null, string? Notes = null, int? PaymentTermsDays = null);

// Kind: raw materials or general expenses; a new one is raw materials unless said.
public sealed record SavePurchaseCategoryRequest(string Name, string? NameAr = null, ExpenseLine? ExpenseLine = null, CategoryKind? Kind = null);

public sealed record SaveExpenseItemRequest(string Name, Guid? CategoryId = null, string? NameAr = null, string? Unit = null);

public sealed record DeletePurchaseCategoryRequest(
    Guid RequestId,
    Guid? MaterialsTo = null,
    Guid? ExpenseItemsTo = null,
    IReadOnlyList<StockUnit>? Units = null,
    string? Reason = null);

public sealed record ChangeMaterialUnitRequest(
    Guid RequestId,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    // How many of the old unit one of the new is: needed once anything records the material.
    decimal? OneNewIsOld = null,
    decimal? CostPerPurchaseUnit = null,
    decimal? ReorderLevel = null,
    string? Reason = null);

public sealed record UpdateRawMaterialRequest(
    string Name,
    decimal ReorderLevel,
    string? Code = null,
    Guid? CategoryId = null,
    string? PurchaseUnit = null,
    decimal? PurchaseUnitSize = null,
    decimal? DefaultYieldPercent = null,
    decimal? CostPerPurchaseUnit = null);
```


[الفصل التالي: الماليات والخزنة والضريبة والتحليلات →](06-financials-safe-tax-and-intelligence.md)
