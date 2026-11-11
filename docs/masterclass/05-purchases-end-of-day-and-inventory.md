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

> 📄 **`backend/src/Costing.Application/Purchases/PurchaseInvoices.cs`** — 440 سطر

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
    decimal Discount = 0);

// What an invoice's lines are named and filed under, read together for a DTO.
internal sealed record InvoiceReading(
    IRawMaterialRepository Materials,
    IExpenseItemRepository Expenses,
    IPurchaseCategoryRepository Categories,
    ISupplierRepository Suppliers,
    ISafeTransactionRepository Safe,
    IApprovalRequestRepository Requests)
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
        return Dto(invoice, materials, expenses, categories, supplier) with
        {
            PaymentStatus = await InvoicePayments.StatusAsync(invoice, Safe, Requests, cancellationToken),
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
    InvoicePaymentStatus PaymentStatus = InvoicePaymentStatus.NotPosted);

// Posted invoices newest first, or the drafts.
public sealed record GetPurchaseInvoicesQuery(PurchaseInvoiceStatus Status) : IRequest<IReadOnlyList<PurchaseInvoiceSummaryDto>>;

internal sealed class GetPurchaseInvoicesQueryHandler(
    IPurchaseInvoiceRepository invoices, ISupplierRepository suppliers, ISafeTransactionRepository safe, IApprovalRequestRepository requests)
    : IRequestHandler<GetPurchaseInvoicesQuery, IReadOnlyList<PurchaseInvoiceSummaryDto>>
{
    public async Task<IReadOnlyList<PurchaseInvoiceSummaryDto>> Handle(GetPurchaseInvoicesQuery request, CancellationToken cancellationToken)
    {
        // Archived ones too: an invoice keeps showing who it was from.
        var names = (await suppliers.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        var listed = await invoices.GetByStatusAsync(request.Status, cancellationToken);
        var paid = await safe.PaidInvoicesAsync(listed.Select(i => i.Id).ToList(), cancellationToken);
        var pending = (await requests.GetPendingAsync(cancellationToken)).Where(r => r.Module == ApprovalModule.Treasury).Select(r => r.RecordId).ToHashSet();
        return listed
            .OrderByDescending(i => i.PostedAtUtc ?? i.CreatedAtUtc)
            .Select(i => new PurchaseInvoiceSummaryDto(
                i.Id, i.Status, i.SupplierId, i.SupplierId is { } id ? names.GetValueOrDefault(id) : null,
                i.SupplierInvoiceNumber, i.InvoiceDate, i.CreatedAtUtc, i.CreatedBy,
                i.PostedAtUtc, i.PostedBy, i.Total, i.Lines.Count, i.AttachmentFileName, i.InventoryTotal, i.ExpenseTotal, i.VoidedAtUtc, i.VoidedBy,
                i.PaymentMethod, i.RevenueDate, InvoicePayments.StatusOf(i, paid.Contains(i.Id), pending.Contains(i.Id))))
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
    IApprovalRequestRepository requests) : IRequestHandler<GetPurchaseInvoiceQuery, PurchaseInvoiceDto?>
{
    public async Task<PurchaseInvoiceDto?> Handle(GetPurchaseInvoiceQuery request, CancellationToken cancellationToken) =>
        await invoices.GetByIdAsync(request.InvoiceId, cancellationToken) is { } invoice
            ? await new InvoiceReading(materials, expenses, categories, suppliers, safe, requests).DtoAsync(invoice, cancellationToken)
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
    decimal Discount = 0) : IRequest<PurchaseInvoiceDto>;

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
    IUnitOfWork unitOfWork) : IRequestHandler<SavePurchaseInvoiceCommand, PurchaseInvoiceDto>
{
    public async Task<PurchaseInvoiceDto> Handle(SavePurchaseInvoiceCommand request, CancellationToken cancellationToken)
    {
        var invoice = await recorder.RecordAsync(request, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await new InvoiceReading(materials, expenses, categories, suppliers, safe, requests).DtoAsync(invoice, cancellationToken);
    }
}

// Step two: confirmed, the stock goes in and the average costs move; expense lines are recorded
// as they are, touching no stock. Its payment is settled as chosen: on credit, owed to the
// supplier; in cash, paid for a manager and asked of one for anyone else (the stock is in either
// way). Posting again, after an answer was lost, returns the posted invoice and changes nothing.
public sealed record PostPurchaseInvoiceCommand(Guid InvoiceId, string StaffName = "", string StaffId = "", bool CanApprove = true)
    : IRequest<PurchaseInvoiceDto>, IRetryOnConflict;

// Posting an invoice: its stock in and its payment settled, for an invoice posted on its own and for
// each invoice of a daily batch alike. Tracked, for the caller to save.
internal sealed class InvoicePoster(
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    IApprovalRequestRepository requests,
    TreasuryWriter treasury)
{
    public async Task PostAsync(PurchaseInvoice invoice, string staffName, string staffId, bool canApprove, CancellationToken cancellationToken)
    {
        var materialIds = invoice.Lines.Where(l => l.RawMaterialId is not null).Select(l => l.RawMaterialId!.Value).ToList();
        IReadOnlyDictionary<Guid, RawMaterial> byId = materialIds.Count == 0
            ? new Dictionary<Guid, RawMaterial>()
            : await materials.GetRequiredByIdsAsync(materialIds, cancellationToken);
        foreach (var movement in invoice.Post(byId, staffName))
            movements.Add(movement);
        await treasury.SettleAsync(invoice, Guid.NewGuid(), staffId, staffName, canApprove, requests, cancellationToken);
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
    IUnitOfWork unitOfWork) : IRequestHandler<PostPurchaseInvoiceCommand, PurchaseInvoiceDto>
{
    public async Task<PurchaseInvoiceDto> Handle(PostPurchaseInvoiceCommand request, CancellationToken cancellationToken)
    {
        var reading = new InvoiceReading(materials, expenses, categories, suppliers, safe, requests);
        var invoice = await invoices.GetRequiredAsync(request.InvoiceId, cancellationToken);
        if (invoice.Status == PurchaseInvoiceStatus.Posted)
            return await reading.DtoAsync(invoice, cancellationToken);

        await poster.PostAsync(invoice, request.StaffName, request.StaffId, request.CanApprove, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await reading.DtoAsync(invoice, cancellationToken);
    }
}

public sealed record DiscardPurchaseInvoiceCommand(Guid InvoiceId) : IRequest;

internal sealed class DiscardPurchaseInvoiceCommandHandler(IPurchaseInvoiceRepository invoices, IUnitOfWork unitOfWork)
    : IRequestHandler<DiscardPurchaseInvoiceCommand>
{
    public async Task Handle(DiscardPurchaseInvoiceCommand request, CancellationToken cancellationToken)
    {
        // Already gone: a retry of a discard that worked.
        if (await invoices.GetByIdAsync(request.InvoiceId, cancellationToken) is not { } invoice)
            return;
        if (invoice.Status == PurchaseInvoiceStatus.Posted)
            throw new DomainException("A posted invoice stays: it is the record of what came in.");

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

> 📄 **`backend/src/Costing.Application/Purchases/InvoiceCorrections.cs`** — 242 سطر

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
    : IRequest<ApprovalResultDto>, IRetryOnConflict;

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

> 📄 **`backend/src/Costing.Application/Purchases/PurchaseBatch.cs`** — 294 سطر

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
    Guid? EndOfDayInvoiceId = null);

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
    IReadOnlyList<BatchAdvance>? Advances = null) : IRequest<PurchaseBatchResult>, IRetryOnConflict;

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
                // Sent again after an answer was lost: posted already, it is not posted twice.
                if (await invoices.GetByIdAsync(entry.InvoiceId, cancellationToken) is { Status: PurchaseInvoiceStatus.Posted } posted)
                {
                    made.Add(posted);
                    continue;
                }

                if (entry.Lines.Count == 0)
                    throw new DomainException("It has no lines: add what was bought, or take the invoice off the batch.");
                var day = entry.EndOfDayInvoiceId is { } given ? await HandedInAsync(given, entry.InvoiceId, request.InvoiceDate, cancellationToken) : null;
                var method = entry.OnCredit ? PurchasePaymentMethod.Credit : request.PaymentMethod;
                var invoice = await recorder.RecordAsync(
                    new SavePurchaseInvoiceCommand(
                        entry.InvoiceId, entry.SupplierId, entry.SupplierInvoiceNumber, request.InvoiceDate, entry.Lines, request.StaffName,
                        method, method == PurchasePaymentMethod.DayRevenue ? request.RevenueDate : null, entry.Discount),
                    cancellationToken);
                await poster.PostAsync(invoice, request.StaffName, request.StaffId, request.CanApprove, cancellationToken);
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
        var reading = new InvoiceReading(materials, expenses, categories, suppliers, safe, requests);
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


### 1.5 الاستلام المباشر والهالك (`StockIntake`)

`ReceivePurchaseCommand` (استلام بإذن) و `RecordSpoilageCommand` (هالك: يخرج المخزون بحركة `Spoilage` بالمتوسط). والمعرّف من المتصفح: الضغط مرتين على شبكة ضعيفة يجد الحركة نفسها ولا يكررها.

> 📄 **`backend/src/Costing.Application/RawMaterials/StockIntake.cs`** — 95 سطر

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

namespace Costing.Application.RawMaterials;

// PurchaseId and StockCountId are generated by the client when the screen opens, not by the
// server. A cashier who taps Save twice on a flaky LAN, or a browser that retries, sends the
// same id again. The second request finds the movements already posted and changes nothing,
// so a delivery is never booked twice.

// Paid from the safe: for a manager at once, and asked of one for anyone else, as an invoice is.
public sealed record ReceivePurchaseCommand(
    Guid PurchaseId, IReadOnlyList<PurchaseLine> Lines, string RecordedBy = "", string StaffId = "", bool CanApprove = true)
    : IRequest<IReadOnlyList<RawMaterialDto>>, IRetryOnConflict;

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
    : IRequest<IReadOnlyList<RawMaterialDto>>, IRetryOnConflict;

// Quantity in the material's own unit. Reason: expired, spoiled, dropped, damaged packaging.
public sealed record SpoilageLine(Guid RawMaterialId, decimal Quantity, string Reason);

internal sealed class RecordSpoilageCommandHandler(
    IRawMaterialRepository materials,
    IStockMovementRepository movements,
    IPurchaseCategoryRepository categories,
    IUnitOfWork unitOfWork) : IRequestHandler<RecordSpoilageCommand, IReadOnlyList<RawMaterialDto>>
{
    public async Task<IReadOnlyList<RawMaterialDto>> Handle(RecordSpoilageCommand request, CancellationToken cancellationToken)
    {
        var byId = await materials.GetRequiredByIdsAsync(
            request.Lines.Select(l => l.RawMaterialId).ToList(), cancellationToken);

        if (!await movements.ExistsAsync(request.SpoilageId, StockMovementReason.Spoilage, cancellationToken))
        {
            foreach (var line in request.Lines)
                movements.Add(byId[line.RawMaterialId].RecordSpoilage(line.Quantity, request.SpoilageId, line.Reason, request.RecordedBy));

            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return await categories.DtosAsync(byId.Values, cancellationToken);
    }
}
```


### 1.6 الموردون

مورد له فواتير يُؤرشف (يختفي من قائمة الاختيار ويبقى على فواتيره) ويُستعاد؛ والمورد بلا فواتير يُحذف.

> 📄 **`backend/src/Costing.Application/Suppliers/Suppliers.cs`** — 129 سطر

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
    DateTime? LastPostedAtUtc)
{
    public static SupplierDto From(Supplier supplier, SupplierUse? use) => new(
        supplier.Id, supplier.Name, supplier.ContactPerson, supplier.Phone, supplier.Email, supplier.Notes, supplier.IsArchived,
        use?.Invoices ?? 0, use?.PostedTotal ?? 0, use?.LastPostedAtUtc);
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
    Guid SupplierId, string Name, string? ContactPerson = null, string? Phone = null, string? Email = null, string? Notes = null)
    : IRequest<SupplierDto>;

internal sealed class SaveSupplierCommandHandler(ISupplierRepository suppliers, IPurchaseInvoiceRepository invoices, IUnitOfWork unitOfWork)
    : IRequestHandler<SaveSupplierCommand, SupplierDto>
{
    public async Task<SupplierDto> Handle(SaveSupplierCommand request, CancellationToken cancellationToken)
    {
        var details = new SupplierDetails(request.Name ?? string.Empty, request.ContactPerson, request.Phone, request.Email, request.Notes);
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
Draft ──(تسليم: Review & confirm)──► Submitted ──(إعادة فتح: مدير)──► Draft
   │                                     │
   └─ إضافة/تعديل/حذف بنود بصورها         ├─ الفواتير ⇐ تظهر في يومية المشتريات لتُنسخ وتُرحّل (مرة واحدة)
                                         ├─ المدفوعات ⇐ قيود خزنة من إيراد اليوم (Vouchered)
                                         │     مدير ⇐ فورًا؛ غيره ⇐ طلبات موافقة
                                         │     سلفة لموظف من HR والربط مفعّل ⇐ HrOutbox مع الإيصال (الفصل 07)
                                         └─ المبيعات ⇐ تملأ نافذة التوريد مسبقًا حتى يُكتب فوقها
```

- **كل إضافة بمعرّف يصنعه المتصفح مرة واحدة** ⇐ لا تكرار عند إعادة الإرسال.
- **المراجعة قبل التسليم:** لا يُسلّم يوم بلا مبيعات، أو بفاتورة/دفعة مكتوبة ولم تُضف.
- الصور في `EndOfDayPhotos` بمفتاح الفاتورة/الدفعة (وصورة Z بمفتاح اليوم)، ويُتحقق من نوعها بأول بايتات وحجمها.

> 📄 **`backend/src/Costing.Application/EndOfDay/EndOfDays.cs`** — 612 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Application.Treasury;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Staff;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;

namespace Costing.Application.EndOfDay;

// The end of the day (تقفيل اليوم) as a branch hands it in: the day's invoices photographed, each
// paid in cash out of the takings or bought on credit, with its supplier and the total on it; the
// cash paid out of the till to suppliers and as advances to employees, each with its receipt; and
// the day's sales report with the float the drawer opened with. Filled in as a draft, an entry at a
// time so a phone sends one photo at a time; submitted, it is kept as it is for the daily batch,
// where each invoice is transcribed from its photo, and for the day's takings, and each payment and
// advance becomes the safe's entry out of the day's takings (a manager's at once, anyone else's
// asked of a manager), its id the payment's own. A manager reopens one to correct it. The day is
// made by its first entry; an entry's id is made by the till, so one sent again is not added twice.
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
    DateTime? PostedAtUtc);

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
    decimal NetCashInTill);

public sealed record EndOfDayPhotoFile(string FileName, string ContentType, byte[] Content);

public sealed record GetEndOfDayQuery(DateOnly Date) : IRequest<EndOfDayDto?>;

// The days handed in over a period, latest first, without their photos.
public sealed record GetEndOfDaysQuery(DateOnly From, DateOnly To) : IRequest<IReadOnlyList<EndOfDayDto>>;

public sealed record SaveEndOfDaySalesCommand(
    DateOnly Date, decimal? CashAmount, decimal? CardAmount, decimal? TaxAmount, decimal? VoidsAmount, string? Notes, string StaffName = "",
    decimal? OpeningFloat = null)
    : IRequest<EndOfDayDto>;

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
    string StaffName = "") : IRequest<EndOfDayDto>;

public sealed record ChangeEndOfDayInvoiceCommand(
    DateOnly Date, Guid InvoiceId, EndOfDayInvoiceKind Kind, Guid SupplierId, decimal ReportedTotal, string? Note, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record ReplaceEndOfDayInvoicePhotoCommand(DateOnly Date, Guid InvoiceId, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record RemoveEndOfDayInvoiceCommand(DateOnly Date, Guid InvoiceId, string StaffName = "") : IRequest<EndOfDayDto>;

public sealed record AttachEndOfDaySalesPhotoCommand(DateOnly Date, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record RemoveEndOfDaySalesPhotoCommand(DateOnly Date, string StaffName = "") : IRequest<EndOfDayDto>;

// Handed in: its payments and advances made the safe's entries (CanApprove, a manager), or asked of
// a manager (StaffId, who asks).
public sealed record SubmitEndOfDayCommand(DateOnly Date, string StaffName = "", string StaffId = "", bool CanApprove = false)
    : IRequest<EndOfDayDto>, IRetryOnConflict;

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
    string StaffName = "") : IRequest<EndOfDayDto>;

public sealed record ChangeEndOfDayPayoutCommand(DateOnly Date, Guid PayoutId, Guid PayeeId, decimal Amount, string? Note, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record ReplaceEndOfDayPayoutReceiptCommand(DateOnly Date, Guid PayoutId, string FileName, string ContentType, byte[] Content, string StaffName = "")
    : IRequest<EndOfDayDto>;

public sealed record RemoveEndOfDayPayoutCommand(DateOnly Date, Guid PayoutId, string StaffName = "") : IRequest<EndOfDayDto>;

public sealed record ReopenEndOfDayCommand(DateOnly Date, string StaffName = "") : IRequest<EndOfDayDto>;

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
    TreasuryWriter treasury)
{
    public IEndOfDayPhotoStore Photos => photos;

    public async Task<EndOfDayReport> OpenAsync(DateOnly date, string by, CancellationToken cancellationToken)
    {
        if (await days.GetByDateAsync(date, cancellationToken) is { } day)
            return day;
        var now = DateTime.UtcNow;
        if (date > new[] { calendar.BusinessDateOf(now), calendar.LocalDateOf(now) }.Max())
            throw new DomainException("That day has not come yet: close a day once it is over. · هذا اليوم لم يأتِ بعد.");
        days.Add(day = new EndOfDayReport(Guid.NewGuid(), date, by));
        return day;
    }

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
        if (await safe.GetByIdAsync(payout.Id, cancellationToken) is not null)
            return EndOfDayVoucherState.InSafe;
        return (await requests.GetByIdAsync(payout.Id, cancellationToken))?.Status switch
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
                if (await safe.GetByIdAsync(payout.Id, cancellationToken) is not null || await requests.GetByIdAsync(payout.Id, cancellationToken) is not null)
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
                    payout.Id, toSupplier ? SafeTransactionKind.SupplierPayment : SafeTransactionKind.EmployeeAdvance, payout.Amount, day.Date,
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
                        payout.Id, ApprovalModule.Treasury, ApprovalAction.Create, payout.Id, summary, changes, ApprovalPayload.Write(voucher),
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
                    EndOfDayPhotoDto.From(i.Photo)!, i.AddedAtUtc, i.PurchaseInvoiceId, i.PostedAtUtc)).ToList(),
                day.CountOf(EndOfDayInvoiceKind.Cash), day.TotalOf(EndOfDayInvoiceKind.Cash),
                day.CountOf(EndOfDayInvoiceKind.Credit), day.TotalOf(EndOfDayInvoiceKind.Credit),
                day.NetSales, day.TotalRevenue, day.CashAfterInvoices, day.ExpectedIntoSafe,
                day.Invoices.Count(i => i.PurchaseInvoiceId is not null), takings?.TakingsTotal,
                day.CreatedBy, day.CreatedAtUtc, day.UpdatedBy, day.UpdatedAtUtc, day.SubmittedBy, day.SubmittedAtUtc, day.ReopenedBy, day.ReopenedAtUtc,
                day.OpeningFloat, payouts,
                day.CountOf(EndOfDayPayoutKind.SupplierPayment), day.TotalOf(EndOfDayPayoutKind.SupplierPayment),
                day.CountOf(EndOfDayPayoutKind.EmployeeAdvance), day.TotalOf(EndOfDayPayoutKind.EmployeeAdvance),
                day.CashTax, day.CashSalesCollected, day.CashPaidOut, day.NetCashInTill));
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
        day.RecordSales(request.CashAmount, request.CardAmount, request.TaxAmount, request.VoidsAmount, request.Notes, request.StaffName, request.OpeningFloat);
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
        day.AddInvoice(request.InvoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, photo, request.StaffName);
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
        day.ChangeInvoice(request.InvoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, request.StaffName);
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

internal sealed class SubmitEndOfDayCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<SubmitEndOfDayCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(SubmitEndOfDayCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        // Sent again after an answer was lost: submitted already.
        if (!day.IsSubmitted)
        {
            day.Submit(request.StaffName);
            await shared.VoucherPayoutsAsync(day, request.StaffId, request.StaffName, request.CanApprove, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        return await shared.DtoAsync(day, cancellationToken);
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

internal sealed class ReopenEndOfDayCommandHandler(EndOfDayDays shared, IUnitOfWork unitOfWork) : IRequestHandler<ReopenEndOfDayCommand, EndOfDayDto>
{
    public async Task<EndOfDayDto> Handle(ReopenEndOfDayCommand request, CancellationToken cancellationToken)
    {
        var day = await shared.GetAsync(request.Date, cancellationToken);
        day.Reopen(request.StaffName);
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


`EndOfDayController`: `multipart/form-data` لإضافة البنود بصورها، و `GET {date}` يعيد 204 إن لم يوجد يوم، والقراءة لأقسام عدة (`Readers`) والتعديل لقسم تقفيل اليوم، وإعادة الفتح بصلاحية القرار.

> 📄 **`backend/src/Costing.Api/Controllers/EndOfDayController.cs`** — 242 سطر

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
// asked of one for anyone else. A day is reopened by a manager. Dates are the business day's,
// yyyy-MM-dd.
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

    // The day, or nothing (204) before anything is handed in for it.
    [HttpGet("{date}")]
    [CostingTab(Readers)]
    public async Task<ActionResult<EndOfDayDto?>> GetDay(DateOnly date, CancellationToken cancellationToken) =>
        await sender.Send(new GetEndOfDayQuery(date), cancellationToken);

    [HttpPut("{date}/sales")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> SaveSales(DateOnly date, EndOfDaySalesRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveEndOfDaySalesCommand(
            date, request.CashAmount, request.CardAmount, request.TaxAmount, request.VoidsAmount, request.Notes, StaffName, request.OpeningFloat), cancellationToken);

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
        return await sender.Send(new AddEndOfDayInvoiceCommand(
            date, invoiceId, kind, supplierId, total, form.Note, file.FileName, file.ContentType, await ContentOf(file, cancellationToken), StaffName), cancellationToken);
    }

    [HttpPut("{date}/invoices/{invoiceId:guid}")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> ChangeInvoice(DateOnly date, Guid invoiceId, EndOfDayInvoiceRequest request, CancellationToken cancellationToken) =>
        sender.Send(new ChangeEndOfDayInvoiceCommand(date, invoiceId, request.Kind, request.SupplierId, request.ReportedTotal, request.Note, StaffName), cancellationToken);

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

    [HttpPost("{date}/submit")]
    [CostingTab(CostingTabs.EndOfDay)]
    public Task<EndOfDayDto> Submit(DateOnly date, CancellationToken cancellationToken) =>
        sender.Send(new SubmitEndOfDayCommand(date, StaffName, StaffId, CanApprove), cancellationToken);

    [HttpPost("{date}/reopen")]
    [CostingTab(Readers)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<EndOfDayDto> Reopen(DateOnly date, CancellationToken cancellationToken) =>
        sender.Send(new ReopenEndOfDayCommand(date, StaffName), cancellationToken);

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

public sealed record EndOfDaySalesRequest(decimal? CashAmount, decimal? CardAmount, decimal? TaxAmount, decimal? VoidsAmount, string? Notes, decimal? OpeningFloat = null);

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

public sealed record EndOfDayInvoiceRequest(EndOfDayInvoiceKind Kind, Guid SupplierId, decimal ReportedTotal, string? Note);

// As the till sends it, text: the total is read with a point for its decimals, whatever the server's language.
public sealed class EndOfDayInvoiceForm
{
    public string? InvoiceId { get; set; }
    public string? Kind { get; set; }
    public string? SupplierId { get; set; }
    public string? ReportedTotal { get; set; }
    public string? Note { get; set; }
    public IFormFile? File { get; set; }
}
```


---

## 3. المبيعات وملخص المبيعات اليومي

### 3.1 المحاسبة

المبيعات هنا **كميات لا فلوس**: "بيع اليوم 40 بيتزا مارجريتا كبيرة". كل سطر يخصم مخزونه **بالوصفة** (`StockRequirements`) بحركة `Sale` بالمتوسط وقتها، ويدخل التقرير النظري. والمال (الإيراد) يأتي من **التوريد** في الخزنة، لا من المبيعات.

### 3.2 الملخص اليومي (`DailySales.cs`)

ملخص واحد لكل يوم (`SalesSource.DailySummary`) كما يعطيه تقرير Z: الصنف (أو حجمه بكوده `6101-2`) والكمية. يُدخل يدويًا أو من شيت عمودين (الفصل 07) أو يأتي من الـ POS (الفصل 07). ملخص ثانٍ لنفس اليوم يُرفض (ألغِ الأول ثم أدخل). الأسطر تُقيَّم بأسعار المنيو للمطابقة (الفصل 06).

> 📄 **`backend/src/Costing.Application/Sales/DailySales.cs`** — 152 سطر

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
    : IRequest<SalesReceiptDto>, IRetryOnConflict;

// A row of the day's sheet: the item, by its code or name (or chosen from the list), and how many sold.
public sealed record DailySaleRow(int Row, string? Item, decimal? Quantity);

// SaleId: the day's summary recorded, or none when no row could be read.
public sealed record DailySalesImportResult(
    DateOnly Date, Guid? SaleId, int Items, int Quantity, decimal Value, IReadOnlyList<SkippedSheetRow> Skipped);

public sealed record ImportDailySalesCommand(DateOnly Date, IReadOnlyList<DailySaleRow> Rows, string StaffName)
    : IRequest<DailySalesImportResult>, IRetryOnConflict;

// The menu as the day's sheet lists it: every item, each size of one sold by size, by its code.
public sealed record DailySalesSheet(IReadOnlyList<string> Items);

public sealed record GetDailySalesSheetQuery : IRequest<DailySalesSheet>;

internal sealed class DailySalesWriter(ISalesReceiptRepository sales, SaleWriter writer, IBusinessCalendar calendar)
{
    public async Task<SalesReceipt> RecordAsync(
        Guid id, DateOnly date, IReadOnlyList<DailySaleLine> lines, string by, SaleWriter.Menu? menu, CancellationToken cancellationToken)
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
            new SaleInput(id, null, date, null, SalesChannel.DineIn, PaymentMethod.Cash, merged, Notes: "Daily sales summary"),
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

        var known = await SaleWriter.Menu.LoadAsync(menu, cancellationToken);
        var items = known.Items.Values.ToList();
        var targets = DailySalesItems.Of(items);
        var skipped = new List<SkippedSheetRow>();
        var lines = new List<DailySaleLine>();
        foreach (var row in request.Rows)
        {
            var (line, reason, reasonAr) = Parse(row, targets, known);
            if (line is not null)
                lines.Add(line);
            else
                skipped.Add(new SkippedSheetRow(row.Row, row.Item, reason!, reasonAr));
        }

        if (lines.Count == 0)
            return new DailySalesImportResult(request.Date, null, 0, 0, 0, skipped);

        var receipt = await writer.RecordAsync(Guid.NewGuid(), request.Date, lines, request.StaffName, known, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new DailySalesImportResult(
            request.Date, receipt.Id, receipt.Lines.Count, receipt.Lines.Sum(l => l.Quantity), receipt.BilledSubtotal, skipped);
    }

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


`Sales.cs`: `SaleStockPoster` (الخصم بالوصفات)، `SaleWriter`، والمرتجعات (حركة `VoidReturn` تعيد المخزون)، وتقرير المبيعات.

> 📄 **`backend/src/Costing.Application/Sales/Sales.cs`** — 280 سطر

```csharp
using MediatR;
using Microsoft.Extensions.Logging;
using Costing.Application.Common;
using Costing.Application.RawMaterials;
using Costing.Domain.Common;
using Costing.Domain.Menu;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.Sales;
using Costing.Domain.StockMovements;

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
    string? Notes = null);

// Turns sold lines into stock movements, each material's share as purchased, by the recipe each
// sells by: Sale for a line charged, then VoidReturn for one refunded after payment, and Waste for
// one voided after the kitchen made it. A line already posted for a reason is skipped, so a
// retried sale posts once. Adds the movements; the caller saves.
internal sealed class SaleStockPoster(
    IRecipeRepository recipes,
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

        var relevant = await recipes.GetByTargetsAsync(StockRequirements.TargetsFor(pending.Select(p => p.Item)), cancellationToken);
        var needs = pending.Select(p => (p.LineId, p.Reason, Needs: StockRequirements.For(p.Item, relevant))).ToList();
        var materialsById = (await materials.GetByIdsAsync(needs.SelectMany(n => n.Needs.Keys).Distinct().ToList(), cancellationToken))
            .ToDictionary(m => m.Id);

        foreach (var (lineId, reason, need) in needs)
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
                    StockMovementReason.Waste => material.RecordWaste(quantity, lineId),
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
            Money(input.TaxAmount), Money(input.PointsAmount), Money(input.RefundedAmount), input.Notes, source, by);
        sales.Add(receipt);
        await poster.PostAsync(receipt.Lines, cancellationToken);
        return receipt;
    }

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

public sealed record RecordSaleCommand(SaleInput Sale, string StaffName) : IRequest<SalesReceiptDto>, IRetryOnConflict;

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
public sealed record RefundSaleCommand(Guid SaleId, Guid? LinePublicId, int? Quantity, string StaffName) : IRequest<SalesReceiptDto>, IRetryOnConflict;

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

internal sealed class GetSalesHandler(ISalesReceiptRepository sales) : IRequestHandler<GetSalesQuery, SalesReport>
{
    public async Task<SalesReport> Handle(GetSalesQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From)
            throw new DomainException("The period ends before it starts.");
        if (request.To.DayNumber - request.From.DayNumber > 92)
            throw new DomainException("Show three months of sales at most.");
        var receipts = await sales.GetForDaysAsync(request.From, request.To, cancellationToken);
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

المسودة تُحفظ أثناء العد (العد قد يستغرق ساعة، والتابلت قد ينام)، ونوعها يمكن تغييره قبل الترحيل، ثم `PostStockCountCommand` يضبط كل خامة على المعدود. معرّف الجرد من المتصفح.

> 📄 **`backend/src/Costing.Application/StockCounts/StockCounts.cs`** — 223 سطر

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

public sealed record StockCountLineDto(Guid RawMaterialId, decimal CountedQuantity, decimal? BookQuantity, decimal? UnitCost);

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
    StockCountKind Kind = StockCountKind.Periodic)
{
    public static StockCountDto From(StockCount count) => new(
        count.Id, count.Status, count.StartedAtUtc, count.StartedBy, count.PostedAtUtc, count.PostedBy,
        count.Lines.Select(l => new StockCountLineDto(l.RawMaterialId, l.CountedQuantity, l.BookQuantity, l.UnitCost)).ToList(),
        count.VoidedAtUtc, count.VoidedBy, count.Kind);
}

// In the material's unit: grams, millilitres, pieces.
public sealed record StockCountLine(Guid RawMaterialId, decimal CountedQuantity);

public sealed record StockCountSummaryDto(
    Guid Id, StockCountStatus Status, DateTime StartedAtUtc, string StartedBy, DateTime? PostedAtUtc, string? PostedBy, int Materials,
    DateTime? VoidedAtUtc = null, string? VoidedBy = null, StockCountKind Kind = StockCountKind.Periodic);

// The draft first, if there is one, then the posted counts, newest first.
public sealed record GetStockCountsQuery : IRequest<IReadOnlyList<StockCountSummaryDto>>;

internal sealed class GetStockCountsQueryHandler(IStockCountRepository counts)
    : IRequestHandler<GetStockCountsQuery, IReadOnlyList<StockCountSummaryDto>>
{
    public async Task<IReadOnlyList<StockCountSummaryDto>> Handle(GetStockCountsQuery request, CancellationToken cancellationToken) =>
        (await counts.GetAllAsync(cancellationToken))
            .OrderBy(c => c.Status)
            .ThenByDescending(c => c.PostedAtUtc ?? c.StartedAtUtc)
            .Select(c => new StockCountSummaryDto(c.Id, c.Status, c.StartedAtUtc, c.StartedBy, c.PostedAtUtc, c.PostedBy, c.Lines.Count, c.VoidedAtUtc, c.VoidedBy, c.Kind))
            .ToList();
}

public sealed record GetStockCountQuery(Guid StockCountId) : IRequest<StockCountDto?>;

internal sealed class GetStockCountQueryHandler(IStockCountRepository counts) : IRequestHandler<GetStockCountQuery, StockCountDto?>
{
    public async Task<StockCountDto?> Handle(GetStockCountQuery request, CancellationToken cancellationToken) =>
        await counts.GetByIdAsync(request.StockCountId, cancellationToken) is { } count ? StockCountDto.From(count) : null;
}

// Creates the draft on its first save. Only one draft at a time: a second is refused, naming the
// one still open. Kind: periodic or opening, as it starts or changed while a draft; none keeps it.
public sealed record SaveStockCountCommand(Guid StockCountId, IReadOnlyList<StockCountLine> Lines, string StaffName = "", StockCountKind? Kind = null)
    : IRequest<StockCountDto>;

internal sealed class SaveStockCountCommandHandler(
    IStockCountRepository counts,
    IRawMaterialRepository materials,
    IUnitOfWork unitOfWork) : IRequestHandler<SaveStockCountCommand, StockCountDto>
{
    public async Task<StockCountDto> Handle(SaveStockCountCommand request, CancellationToken cancellationToken)
    {
        // Every listed material must exist; an empty draft is allowed while it is being started.
        if (request.Lines.Count > 0)
            await materials.GetRequiredByIdsAsync(request.Lines.Select(l => l.RawMaterialId).ToList(), cancellationToken);

        var count = await counts.GetByIdAsync(request.StockCountId, cancellationToken);
        if (count is null)
        {
            if (await counts.GetDraftAsync(cancellationToken) is { } open)
                throw new DomainException(
                    $"{open.StartedBy} started a count at {open.StartedAtUtc:HH:mm} UTC that is still open: finish or discard it first.");
            count = new StockCount(request.StockCountId, request.StaffName, request.Kind ?? StockCountKind.Periodic);
            counts.Add(count);
        }
        else if (request.Kind is { } kind)
            count.SetKind(kind);

        count.Record(request.Lines.Select(l => (l.RawMaterialId, l.CountedQuantity)).ToList());
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return StockCountDto.From(count);
    }
}

// Posting again, after an answer was lost, returns the posted count and changes nothing.
public sealed record PostStockCountCommand(Guid StockCountId, string StaffName = "") : IRequest<StockCountDto>, IRetryOnConflict;

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
    : IRequest<IReadOnlyList<RawMaterialDto>>, IRetryOnConflict;

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

> 📄 **`backend/src/Costing.Application/Waste/Breakage.cs`** — 74 سطر

```csharp
using MediatR;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Staff;
using Costing.Domain.Waste;

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

internal sealed class GetBreakageHandler(IBreakageEntryRepository breakage, IStaffMemberRepository staff)
    : IRequestHandler<GetBreakageQuery, IReadOnlyList<BreakageEntryDto>>
{
    public async Task<IReadOnlyList<BreakageEntryDto>> Handle(GetBreakageQuery request, CancellationToken cancellationToken)
    {
        if (request.To < request.From)
            throw new DomainException("The period ends before it starts.");
        var names = (await staff.GetAllAsync(cancellationToken)).ToDictionary(s => s.Id, s => s.Name);
        return (await breakage.GetBetweenAsync(request.From, request.To, cancellationToken)).Select(b => BreakageDtos.Of(b, names)).ToList();
    }
}

// Its id is made by the app, so a retried entry is recorded once.
public sealed record RecordBreakageCommand(
    Guid Id, DateOnly Date, string Description, int Quantity, decimal? UnitCost, Guid? EmployeeId, string? Notes, string StaffName)
    : IRequest<BreakageEntryDto>, IRetryOnConflict;

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


## 6. `InventoryController` (`api/inventory`)

أكبر Controller: الخامات والوحدات، الوصفات والمصنعات، أوامر الإنتاج، الجرد، الهالك، الفواتير ويومية المشتريات وتعديلها وصورها، الفئات والمصروفات والموردون، و **طلبات الحذف** (`deletion-requests`). الصلاحيات على كل endpoint (لا تعتمد على السجل)، و `CanApprove` يقرر "200 تنفيذ" أم "202 طلب".

> 📄 **`backend/src/Costing.Api/Controllers/InventoryController.cs`** — 833 سطر

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
        return File(RawMaterialWorkbook.Build(sheet.Categories), RawMaterialWorkbook.ContentType, RawMaterialWorkbook.FileName);
    }

    // The raw materials as they are, under the template's columns: edited and imported back, or
    // imported into another installation.
    [HttpGet("raw-materials/export")]
    [CostingTab(CostingTabs.Materials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<IActionResult> ExportRawMaterials(CancellationToken cancellationToken)
    {
        var sheet = await sender.Send(new GetRawMaterialSheetQuery(), cancellationToken);
        return File(RawMaterialWorkbook.Build(sheet.Categories, sheet.Lines), RawMaterialWorkbook.ContentType, RawMaterialWorkbook.ExportFileName);
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
            request.PaymentMethod, request.RevenueDate, request.Discount), cancellationToken);

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
        sender.Send(new SaveSupplierCommand(supplierId, request.Name, request.ContactPerson, request.Phone, request.Email, request.Notes), cancellationToken);

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

    // Thrown-away raw stock: expired, spoiled, dropped. SpoilageId makes a retry harmless.
    [HttpPost("spoilage")]
    [CostingTab(CostingTabs.Waste)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<RawMaterialDto>> RecordSpoilage(RecordSpoilageCommand command, CancellationToken cancellationToken) =>
        sender.Send(command with { RecordedBy = StaffName }, cancellationToken);

    // A whole physical count in one request, recorded and posted at once: sets stock to what is
    // on the shelf and records the difference. StockCountId makes a retry harmless, as PurchaseId
    // does above. The screens fill in a draft instead, below.
    [HttpPost("stock-counts")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<RawMaterialDto>> RecordStockCount(RecordStockCountCommand command, CancellationToken cancellationToken) =>
        sender.Send(command with { StaffName = StaffName }, cancellationToken);

    // Counts are a manager's: a count sheet shows what is on the shelves, and a posted one what the
    // records expected.
    [HttpGet("stock-counts")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<IReadOnlyList<StockCountSummaryDto>> GetStockCounts(CancellationToken cancellationToken) =>
        sender.Send(new GetStockCountsQuery(), cancellationToken);

    [HttpGet("stock-counts/{stockCountId:guid}")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public async Task<ActionResult<StockCountDto>> GetStockCount(Guid stockCountId, CancellationToken cancellationToken) =>
        await sender.Send(new GetStockCountQuery(stockCountId), cancellationToken) is { } count ? count : NotFound();

    // Saves the draft as it stands, creating it on the first save. The whole list each time: a
    // material left out is not counted.
    [HttpPut("stock-counts/{stockCountId:guid}")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StockCountDto> SaveStockCount(Guid stockCountId, SaveStockCountRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveStockCountCommand(stockCountId, request.Lines ?? [], StaffName, request.Kind), cancellationToken);

    // Sets stock to what was counted. Posting again returns the posted count.
    [HttpPost("stock-counts/{stockCountId:guid}/post")]
    [CostingTab(CostingTabs.Counts)]
    [Authorize(Policy = Permissions.InventoryManage)]
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
        sender.Send(new ApproveRequestCommand(requestId, StaffName), cancellationToken);

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

    private string StaffId => UserClaims.IdOf(User) ?? string.Empty;

    private RequestDeletionCommand DeletionOf(Guid requestId, ApprovalModule module, Guid recordId, string? reason) =>
        new(requestId, module, recordId, reason, StaffId, StaffName, CanApprove);
}

// Kind: periodic or opening stock; none keeps the draft's (a new one is periodic).
public sealed record SaveStockCountRequest(IReadOnlyList<StockCountLine> Lines, Costing.Domain.StockCounts.StockCountKind? Kind = null);

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
    decimal Discount = 0);

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
    Guid? RecipeCategoryId = null)
{
    public SavePrepItemCommand ToCommand(Guid? id) =>
        new(id, Name, Unit, BatchQuantity, Ingredients ?? [], Code, CategoryId, DisplayUnit, DisplayUnitSize, ReorderLevel, RecipeCategoryId);
}

public sealed record SaveRecipeRequest(
    string? Name,
    RecipeTargetKind? TargetKind,
    int? CatalogItemId,
    int? VariantId,
    int Portions,
    IReadOnlyList<RecipeIngredientDto> Ingredients,
    Guid? RecipeCategoryId = null,
    decimal? PlannedPrice = null)
{
    public SaveRecipeCommand ToCommand(Guid? id) =>
        new(id, Name, TargetKind, CatalogItemId, VariantId, Portions, Ingredients ?? [], RecipeCategoryId, PlannedPrice);
}

public sealed record SaveRecipeCategoryRequest(string Name, string? NameAr = null);

public sealed record RestoreRecipeRequest(string? Name);

public sealed record MakeProductionOrderRequest(
    Guid PrepItemId, decimal PlannedQuantity, decimal ProducedQuantity, string? Notes = null, Guid? RequestId = null, string? Reason = null);

public sealed record ReviseProductionOrderRequest(
    Guid RequestId, Guid NewOrderId, decimal PlannedQuantity, decimal ProducedQuantity, string? Notes = null, string? Reason = null);

public sealed record RequestDeletionBody(Guid RequestId, ApprovalModule Module, Guid RecordId, string? Reason = null);

public sealed record RejectRequestBody(string? Note = null);

public sealed record SaveSupplierRequest(string Name, string? ContactPerson = null, string? Phone = null, string? Email = null, string? Notes = null);

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
