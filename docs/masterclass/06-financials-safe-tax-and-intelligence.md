# الفصل 06: الماليات، الخزنة، الضريبة، والتحليلات الذكية

[← الفصل السابق](05-purchases-end-of-day-and-inventory.md) · [الفهرس](00-index-and-build-roadmap.md) · [الفصل التالي: محركات الإكسيل والربط →](07-excel-engines-and-ecosystem-links.md)

## 1. الخزنة الموحدة (The Safe)

### 1.1 النموذج المحاسبي

الخزنة **وعاء نقدي واحد** (Treasury)، وفيه صندوقان (`CashFund`):

- **`Safe`**: الخزنة نفسها.
- **`DayRevenue`**: "درج يوم معيّن": إيراد يوم لم يُورَّد بعد. يمكن الدفع منه مباشرة (فاتورة نقدية دُفعت من إيراد اليوم) قبل أن يدخل الخزنة.

كل قيد (`SafeTransaction`) داخل أو خارج، ولا يُعدَّل: الإلغاء = **قيد عكسي** (`ReversalOf`) بتاريخ اليوم، والأصل يُعلَّم ملغى.

| النوع | الاتجاه | أثره المحاسبي |
| --- | --- | --- |
| `OpeningBalance` رصيد افتتاحي | داخل | بداية |
| `Funding` تمويل (مرحّل، تمويل الشركاء، آخر) | داخل | ليس إيرادًا |
| `RevenueTransfer` توريد اليومية | داخل | **صافي المبيعات = إيراد**، والضريبة **التزام** |
| `ExpenseVoucher` إذن صرف مصروفات | خارج | مصروف تحت فئته في قائمة الدخل |
| `SupplierPayment` / `InvoicePayment` | خارج | يخفض دين المورد (ليس مصروفًا: المصروف كان عند الشراء) |
| `EmployeeAdvance` سلفة | خارج | **ليس مصروفًا**: يُخصم من راتب الموظف |
| `SalaryPayment` صرف راتب | خارج | تكلفة عمالة لشهره |
| `PayrollPayment` صرف مسير HR | خارج | صافي النقدية لمسير معتمد (تكلفة العمالة تُحسب من المسير نفسه، الفصل 07) |
| `TaxPayment` سداد ضرائب | خارج | **ليس مصروفًا**: يسدد الالتزام فيخفض "الضريبة المستحقة" |

### 1.2 التوريد وفصل الضريبة كالتزام

الإيراد في قائمة الدخل = **الكاش + الفيزا قبل الضريبة**. الضريبة المحصّلة تدخل الخزنة نقدًا (أموال الدولة في عهدتك)، وتخرج عند توريدها بقيد `TaxPayment`:

```text
التوريد:   المبلغ في الخزنة = الكاش + الفيزا + الضريبة − ما دُفع من الدرج
الإيراد:   NetAmount       = الكاش + الفيزا                      (قبل الضريبة)
الالتزام:  الضريبة المستحقة الآن = Σ الضريبة المحصّلة − Σ المورَّد للدولة
```

**`SafeTransaction.Takings(cash, card, tax?, taxPercent?)`** (الفصل 02):

- إن أُعطيت الضريبة صراحة (من تقرير Z): كما هي، بشرط ألا تتجاوز المبيعات.
- إن أُعطيت **النسبة** فقط والمبالغ **شاملة** الضريبة:
  ```text
  TaxIn(gross, rate) = gross − round(gross ÷ (1 + rate/100), 2)       ← الضريبة الكلية للقرش
  ضريبة الكاش = round(الضريبة الكلية × الكاش ÷ (الكاش + الفيزا), 2)
  ضريبة الفيزا = الضريبة الكلية − ضريبة الكاش                         ← الباقي، لا تقريب ثانٍ
  ```
  مثال: كاش 1,140 + فيزا 570 شاملة 14%: الإجمالي 1,710 ⇐ قبل الضريبة 1,500 ⇐ الضريبة 210؛ ضريبة الكاش = 210 × 1140 ÷ 1710 = 140؛ ضريبة الفيزا = 70. الكاش قبل الضريبة 1,000، الفيزا 500. **والجمع يرجع للمُدخَل بالقرش دائمًا** لأن الجزء الثاني "باقٍ" لا "مقرّب".

### 1.3 حساب المورد

دين المورد = رصيده الافتتاحي (`SupplierLedgerEntry`) + فواتيره الآجلة − ما دُفع له. وكشف الحساب يعرض كل حركة بترتيبها مع الرصيد بعدها.

### 1.4 الكود: `Treasury.cs`

- **`TreasuryWriter`**: قلب الخزنة: `CheckAsync` (القواعد: مبلغ موجب، لا يتجاوز دين المورد، سلفة لموظف نشط، صرف مسير بنفس صافيه وشهره…)، `DescribeAsync` (سطور التغيير للمدير)، `ApplyAsync` (إنشاء القيد، وتعليم الفاتورة مدفوعة، ومسير HR مصروفًا، وإرسال السلفة لـ HR عبر `HrOutbox`)، و `VoidAsync` (القيد العكسي وما يتبعه: إعادة فتح المسير، إرسال إلغاء السلفة).
- `RecordSafeVoucherCommand`: المدير فورًا، وغيره طلب (`ApprovalModule.Treasury`، ومعرّف الطلب = معرّف القيد).
- `PayPurchaseInvoiceCommand`، `SetSupplierOpeningBalanceCommand`.
- `ITaxRate`: نسبة الضريبة الحالية من إعدادات الضريبة والخدمة.

> 📄 **`backend/src/Costing.Application/Treasury/Treasury.cs`** — 910 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Domain.Staff;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Expenses;
using Costing.Domain.FixedAssets;
using Costing.Domain.Purchases;
using Costing.Domain.Sales;
using Costing.Domain.Suppliers;
using Costing.Domain.Treasury;

namespace Costing.Application.Treasury;

// The treasury (الماليات): the safe's ledger and what is owed to suppliers. Money goes into the
// safe as its opening balance, as funding, or as a day's takings; it goes out as expense
// vouchers, tax paid over, supplier payments, invoices paid in cash, employees' advances and
// salaries, from the safe or straight from a day's takings. An invoice on credit is owed to its
// supplier until a payment voucher pays it. An advance is owed by the employee until the payroll
// of its own month deducts it.
//
// A day's takings are entered once, from the day's Z report: its cash and card sales before tax,
// the tax collected on them, and its voids. The safe is the one treasury: all of it, cash, card
// and tax, goes in. What was paid straight out of them by then came out of the drawer, so the safe
// gets the rest; what is paid out of them, or put back by a void, once they are in, moves the
// safe. The net sales (cash and card) are the revenue; the tax is held for the tax authority until
// a tax payment (سداد ضرائب) pays it over, never revenue and never an expense.
//
// Every safe entry is a manager's: anyone else's is a request (ApprovalRequests.cs), and no cash
// moves until it is approved. A supplier's opening debt moves no cash, and is entered at once.

// A safe entry as entered: held by a request until a manager approves it. TransactionId is made
// by the till. A day's takings' Amount is their cash; CardAmount their card takings, TaxAmount
// the tax collected in both, VoidsAmount the day's voids and refunds. IncludesTax instead of
// TaxAmount: the cash includes tax at the till's rate (TaxPercent, set by the server when it is
// entered, never the screen's, and kept with a request so the approval takes the same tax off).
public sealed record SafeVoucher(
    Guid TransactionId,
    SafeTransactionKind Kind,
    decimal Amount,
    DateOnly Date,
    FundingSource? Source = null,
    DateOnly? RevenueDate = null,
    Guid? SupplierId = null,
    Guid? ExpenseItemId = null,
    Guid? PurchaseInvoiceId = null,
    string? Notes = null,
    bool IncludesTax = false,
    decimal? TaxPercent = null,
    // An advance's or a salary's employee; a salary's month (its first day).
    Guid? EmployeeId = null,
    DateOnly? PayrollMonth = null,
    decimal? CardAmount = null,
    decimal? TaxAmount = null,
    decimal? VoidsAmount = null,
    // A payroll payment's: the payroll run from HR it pays.
    Guid? PayrollRunId = null,
    // A day's takings': the discounts and promos taken off the menu prices, and why (Discounts).
    decimal? DiscountsAmount = null,
    IReadOnlyList<DiscountReason>? DiscountReasons = null,
    // A fixed asset bought or sold: out of or into the safe (the default) or the bank (Fund); the
    // asset (FixedAssetId, made by the till for one bought); and, bought, what it is (Asset). Amount
    // is what it cost or brought in, Date the day it was bought or sold.
    CashFund? Fund = null,
    Guid? FixedAssetId = null,
    FixedAssetInput? Asset = null);

// A fixed asset as it is entered: what it is, where it is, and what its depreciation is worked out
// from. Its cost and the day it was bought are its payment's, or entered with it when it is owned already.
public sealed record FixedAssetInput(
    string Name,
    FixedAssetCategory Category,
    int UsefulLifeMonths,
    decimal SalvageValue = 0,
    string? Location = null,
    string? Notes = null);

// The tax rate the bills are charged, as set on Tax & service.
public interface ITaxRate
{
    Task<decimal> PercentAsync(CancellationToken cancellationToken);
}

public sealed record SafeTransactionDto(
    Guid Id,
    SafeTransactionKind Kind,
    CashFund Fund,
    decimal Amount,
    DateOnly BusinessDate,
    DateOnly? RevenueDate,
    FundingSource? Source,
    Guid? SupplierId,
    Guid? PurchaseInvoiceId,
    Guid? ExpenseItemId,
    string? Notes,
    string RecordedBy,
    DateTime RecordedAtUtc,
    string? ApprovedBy,
    Guid? ReversalOf,
    DateTime? VoidedAtUtc,
    string? VoidedBy,
    bool IncludesTax,
    decimal? TaxPercent,
    decimal TaxAmount,
    decimal? GrossAmount,
    Guid? EmployeeId,
    DateOnly? PayrollMonth,
    decimal CardAmount = 0,
    decimal VoidsAmount = 0,
    decimal NetAmount = 0,
    decimal DiscountsAmount = 0,
    IReadOnlyList<DiscountReason>? DiscountReasons = null,
    Guid? FixedAssetId = null)
{
    public static SafeTransactionDto From(SafeTransaction t) => new(
        t.Id, t.Kind, t.Fund, t.Amount, t.BusinessDate, t.RevenueDate, t.Source, t.SupplierId, t.PurchaseInvoiceId, t.ExpenseItemId, t.Notes,
        t.RecordedBy, t.RecordedAtUtc, t.ApprovedBy, t.ReversalOf, t.VoidedAtUtc, t.VoidedBy, t.IncludesTax, t.TaxPercent, t.TaxAmount,
        t.GrossAmount, t.EmployeeId, t.PayrollMonth, t.CardAmount, t.VoidsAmount, t.Kind == SafeTransactionKind.RevenueTransfer ? t.NetAmount : 0,
        t.DiscountsAmount, t.DiscountReasons.ToList(), t.FixedAssetId);
}

// Checks, describes and enters safe entries: for a manager's own and for an approval alike. What
// it enters is added to the safe's and the suppliers' ledgers, for the caller to save.
internal sealed class TreasuryWriter(
    ISafeTransactionRepository safe,
    ISupplierLedgerRepository suppliersLedger,
    ISupplierRepository suppliers,
    IExpenseItemRepository expenses,
    IPurchaseInvoiceRepository invoices,
    IRecordDescriptions descriptions,
    ITaxRate taxRate,
    IStaffMemberRepository employees,
    IPayrollRunRepository payrollRuns,
    Costing.Application.Integrations.HrOutbox hr,
    IFixedAssetRepository assets)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // Invoices posted in this unit of work, not saved yet: read from here, not the database.
    private readonly Dictionary<Guid, PurchaseInvoice> _posting = [];

    // The business day: the one cash belongs to, as the day report counts it. Between midnight
    // and the hour the business day starts, the restaurant's calendar is a day ahead of it; an
    // entry dated that calendar day is taken as well (Latest), never one later.
    public DateOnly Today => descriptions.BusinessDateOf(DateTime.UtcNow);

    public DateOnly Latest
    {
        get
        {
            var now = DateTime.UtcNow;
            var (business, calendar) = (descriptions.BusinessDateOf(now), descriptions.LocalDateOf(now));
            return calendar > business ? calendar : business;
        }
    }

    // A voucher as the screens sent it, with the till's tax rate when its takings include tax. Any
    // rate the screen sent is replaced: the rate is the till's, not the caller's.
    public async Task<SafeVoucher> WithTaxRateAsync(SafeVoucher voucher, CancellationToken cancellationToken)
    {
        // The tax collected as the Z report gives it: nothing to work out.
        if (voucher.TaxAmount is not null)
            return voucher with { IncludesTax = false, TaxPercent = null };
        if (!voucher.IncludesTax)
            return voucher with { TaxPercent = null };
        if (voucher.Kind != SafeTransactionKind.RevenueTransfer)
            throw new DomainException("Only a day's takings are entered with the tax in them.");
        return voucher with { TaxPercent = await taxRate.PercentAsync(cancellationToken) };
    }

    // What would stop it being entered now, refused before a request goes to a manager. Checked
    // again on approval, as balances may have moved.
    public async Task CheckAsync(SafeVoucher voucher, CancellationToken cancellationToken)
    {
        if (voucher.IncludesTax && (voucher.Kind != SafeTransactionKind.RevenueTransfer || voucher.TaxPercent is null))
            throw new DomainException("Only a day's takings are entered with the tax in them, at the till's rate.");
        if (voucher.Date > Latest)
            throw new DomainException("A safe entry is dated today or before: cash cannot move in the future.");
        if (voucher.RevenueDate > Latest)
            throw new DomainException("Those takings are of a day that has not come yet.");
        if (voucher.RevenueDate > voucher.Date)
            throw new DomainException("A day's takings are used on that day or after it.");
        if (voucher.Notes?.Trim().Length > SafeTransaction.MaxNotesLength)
            throw new DomainException($"Keep the notes under {SafeTransaction.MaxNotesLength} characters. · الملاحظات {SafeTransaction.MaxNotesLength} حرف على الأكثر.");
        if (voucher.Kind != SafeTransactionKind.RevenueTransfer && (voucher.CardAmount is not null || voucher.TaxAmount is not null || voucher.VoidsAmount is not null
            || voucher.DiscountsAmount is not null || voucher.DiscountReasons is { Count: > 0 }))
            throw new DomainException("Only a day's takings have card takings, tax, voids and discounts.");
        var forAsset = voucher.Kind is SafeTransactionKind.AssetPurchase or SafeTransactionKind.AssetSale;
        if (!forAsset && (voucher.Fund is not (null or CashFund.Safe) || voucher.FixedAssetId is not null || voucher.Asset is not null))
            throw new DomainException("Only a fixed asset is bought or sold through the bank. · البنك للأصول الثابتة فقط.");
        if (forAsset && voucher.Fund is not (null or CashFund.Safe or CashFund.Bank))
            throw new DomainException("Pay it from the safe or the bank. · من الخزنة أو البنك.");
        if (forAsset && voucher.RevenueDate is not null)
            throw new DomainException("A fixed asset is paid from the safe or the bank, not a day's takings.");
        switch (voucher.Kind)
        {
            case SafeTransactionKind.OpeningBalance:
                if (await safe.AnyOpeningBalanceAsync(cancellationToken))
                    throw new DomainException("The safe already has its opening balance. Money put in since is funding.");
                if (voucher.Source is not (FundingSource.CarriedOver or FundingSource.OwnerFinancing))
                    throw new DomainException("Say where the opening balance came from: carried over, or the owners' financing.");
                break;
            case SafeTransactionKind.Funding:
                if (voucher.Source is not (FundingSource.OwnerFinancing or FundingSource.Other))
                    throw new DomainException("Say where the money came from: the owners' financing, or another source.");
                break;
            case SafeTransactionKind.RevenueTransfer:
                if (voucher.RevenueDate is not { } day)
                    throw new DomainException("Choose the day whose takings go into the safe.");
                // One Z report a day.
                if (await safe.GetTakingsAsync(day, cancellationToken) is { } entered)
                    throw new DomainException(
                        $"The takings of {Day(day)} are entered already: {Money(entered.TakingsTotal)}. To change them, void that entry and enter them again. · " +
                        "إيراد هذا اليوم مسجل بالفعل: ألغه من الخزنة ثم أدخله من جديد.");
                if (voucher.VoidsAmount < 0)
                    throw new DomainException("The cash, card, tax and voids are zero or more. · المبالغ صفر أو أكثر.");
                Discounts.Clean(voucher.DiscountsAmount ?? 0, voucher.DiscountReasons);
                Takings(voucher);
                // Checked: zero cash with card takings is a day's takings all the same.
                return;
            case SafeTransactionKind.TaxPayment:
                if (voucher.ExpenseItemId is not null || voucher.SupplierId is not null || voucher.EmployeeId is not null)
                    throw new DomainException("A tax payment pays the tax authority, nothing else.");
                break;
            case SafeTransactionKind.ExpenseVoucher:
                await ExpenseItemAsync(voucher.ExpenseItemId, cancellationToken);
                break;
            case SafeTransactionKind.SupplierPayment:
            {
                var supplier = await SupplierAsync(voucher.SupplierId, cancellationToken);
                var owed = await suppliersLedger.BalanceAsync(supplier.Id, cancellationToken);
                if (voucher.Amount > owed)
                    throw new DomainException(owed > 0
                        ? $"{supplier.Name} is owed {Money(owed)}: pay that much or less."
                        : $"Nothing is owed to {supplier.Name}.");
                break;
            }
            case SafeTransactionKind.InvoicePayment:
                await UnpaidInvoiceAsync(voucher.PurchaseInvoiceId, cancellationToken);
                break;
            case SafeTransactionKind.EmployeeAdvance:
            {
                // No one named: advances handed out as a lump sum, for the staff to share.
                if (voucher.EmployeeId is null)
                    break;
                var employee = await EmployeeAsync(voucher.EmployeeId, cancellationToken);
                if (!employee.IsActive)
                    throw new DomainException($"{employee.Name} has left: bring them back on Staff first.");
                break;
            }
            case SafeTransactionKind.SalaryPayment:
            {
                await SalaryAsync(voucher, cancellationToken);
                break;
            }
            case SafeTransactionKind.PayrollPayment:
            {
                var run = await PayrollRunAsync(voucher.PayrollRunId, cancellationToken);
                if (voucher.Amount != run.NetCashPayable || voucher.PayrollMonth != run.Period)
                    throw new DomainException($"The payroll of {run.PeriodName} is paid as HR sent it: {Money(run.NetCashPayable)}.");
                break;
            }
            case SafeTransactionKind.AssetPurchase:
            {
                if (voucher.FixedAssetId is not { } assetId || voucher.Asset is not { } asset)
                    throw new DomainException("Say what the asset is. · أدخل بيانات الأصل.");
                if (await assets.GetByIdAsync(assetId, cancellationToken) is not null)
                    throw new DomainException("This asset is on the register already.");
                // Checked as it would be made: its name, category, life and salvage value against its cost.
                _ = NewAsset(voucher, asset, assetId, 1, voucher.Fund ?? CashFund.Safe, Guid.NewGuid(), "check");
                break;
            }
            case SafeTransactionKind.AssetSale:
            {
                var sold = await AssetOnRegisterAsync(voucher.FixedAssetId, cancellationToken);
                if (sold.IsGone)
                    throw new DomainException($"{sold.AssetCode} {sold.Name} is disposed of already. · الأصل مستبعد بالفعل.");
                if (voucher.Date < sold.PurchaseDate)
                    throw new DomainException("An asset is sold on the day it was bought or after. · تاريخ البيع بعد تاريخ الشراء.");
                break;
            }
            default:
                throw new DomainException("Say what the safe entry is.");
        }

        if (voucher.Kind != SafeTransactionKind.OpeningBalance && voucher.Amount <= 0)
            throw new DomainException("Enter an amount more than nothing.");
        if (voucher.Amount < 0)
            throw new DomainException("Enter an amount of zero or more.");
    }

    // Enters it: the safe's ledger line, and for a supplier payment its line on the supplier's
    // account. recordedBy is who entered it; approvedBy, the manager who approved it.
    public async Task<SafeTransaction> ApplyAsync(SafeVoucher voucher, string recordedBy, string? approvedBy, CancellationToken cancellationToken)
    {
        await CheckAsync(voucher, cancellationToken);
        var id = voucher.TransactionId;
        SafeTransaction entry;
        switch (voucher.Kind)
        {
            case SafeTransactionKind.OpeningBalance:
                entry = SafeTransaction.OpeningBalance(id, voucher.Amount, voucher.Date, voucher.Source!.Value, voucher.Notes, recordedBy, approvedBy);
                break;
            case SafeTransactionKind.Funding:
                entry = SafeTransaction.Funding(id, voucher.Amount, voucher.Date, voucher.Source!.Value, voucher.Notes, recordedBy, approvedBy);
                break;
            case SafeTransactionKind.RevenueTransfer:
                entry = SafeTransaction.RevenueTransfer(
                    id, voucher.Amount, voucher.Date, voucher.RevenueDate!.Value, voucher.Notes, recordedBy, approvedBy,
                    voucher.IncludesTax ? voucher.TaxPercent : null, await safe.PaidOutOfTakingsAsync(voucher.RevenueDate.Value, cancellationToken),
                    voucher.CardAmount ?? 0, voucher.TaxAmount, voucher.VoidsAmount ?? 0, voucher.DiscountsAmount ?? 0, voucher.DiscountReasons);
                break;
            case SafeTransactionKind.ExpenseVoucher:
                entry = SafeTransaction.ExpenseVoucher(id, voucher.Amount, voucher.Date, voucher.ExpenseItemId!.Value, voucher.Notes, recordedBy, approvedBy);
                break;
            case SafeTransactionKind.TaxPayment:
                entry = SafeTransaction.TaxPayment(id, voucher.Amount, voucher.Date, voucher.Notes, recordedBy, approvedBy);
                break;
            case SafeTransactionKind.SupplierPayment:
                entry = SafeTransaction.SupplierPayment(
                    id, voucher.Amount, voucher.Date, voucher.SupplierId!.Value, voucher.Notes, recordedBy, approvedBy, voucher.RevenueDate,
                    await TakingsInSafeAsync(voucher.RevenueDate, cancellationToken));
                suppliersLedger.Add(SupplierLedgerEntry.Payment(entry));
                break;
            case SafeTransactionKind.InvoicePayment:
            {
                var invoice = await UnpaidInvoiceAsync(voucher.PurchaseInvoiceId, cancellationToken);
                entry = SafeTransaction.InvoicePayment(
                    id, invoice.Total, voucher.Date, invoice.Id, invoice.SupplierId, invoice.RevenueDate, recordedBy, approvedBy,
                    await TakingsInSafeAsync(invoice.RevenueDate, cancellationToken));
                break;
            }
            case SafeTransactionKind.EmployeeAdvance:
                entry = voucher.EmployeeId is not { } advancedTo
                    ? SafeTransaction.PendingAdvance(
                        id, voucher.Amount, voucher.Date, voucher.Notes, recordedBy, approvedBy, voucher.RevenueDate,
                        await TakingsInSafeAsync(voucher.RevenueDate, cancellationToken))
                    : SafeTransaction.EmployeeAdvance(
                        id, voucher.Amount, voucher.Date, advancedTo, PayMonthOf(voucher.Date),
                        voucher.Notes, recordedBy, approvedBy, voucher.RevenueDate, await TakingsInSafeAsync(voucher.RevenueDate, cancellationToken));
                // An employee from HR: sent to HR, to come off their pay there.
                await hr.AdvanceAsync(entry, voided: false, cancellationToken);
                break;
            case SafeTransactionKind.SalaryPayment:
                entry = SafeTransaction.SalaryPayment(
                    id, voucher.Amount, voucher.Date, voucher.EmployeeId!.Value, voucher.PayrollMonth!.Value, voucher.Notes, recordedBy, approvedBy,
                    voucher.RevenueDate, await TakingsInSafeAsync(voucher.RevenueDate, cancellationToken));
                break;
            case SafeTransactionKind.PayrollPayment:
            {
                // Paid: the run is paid, and HR told so.
                var run = await PayrollRunAsync(voucher.PayrollRunId, cancellationToken);
                entry = SafeTransaction.PayrollPayment(id, voucher.Amount, voucher.Date, run.Id, run.Period, voucher.Notes, recordedBy, approvedBy);
                run.Disbursed(entry.Id, approvedBy ?? recordedBy);
                await hr.PayrollAsync(run, entry, voided: false, cancellationToken);
                break;
            }
            case SafeTransactionKind.AssetPurchase:
            {
                // Out of the safe or the bank on the day it is bought, and on the register from then.
                var fund = voucher.Fund ?? CashFund.Safe;
                entry = SafeTransaction.AssetPurchase(id, voucher.Amount, voucher.Date, voucher.FixedAssetId!.Value, fund, voucher.Notes, recordedBy, approvedBy);
                assets.Add(NewAsset(voucher, voucher.Asset!, voucher.FixedAssetId.Value, await assets.NextNumberAsync(cancellationToken), fund, entry.Id,
                    approvedBy ?? recordedBy));
                break;
            }
            case SafeTransactionKind.AssetSale:
            {
                var fund = voucher.Fund ?? CashFund.Safe;
                var sold = await AssetOnRegisterAsync(voucher.FixedAssetId, cancellationToken);
                entry = SafeTransaction.AssetSale(id, voucher.Amount, voucher.Date, sold.Id, fund, voucher.Notes, recordedBy, approvedBy);
                sold.Sell(voucher.Date, voucher.Amount, fund, entry.Id, voucher.Notes, approvedBy ?? recordedBy);
                break;
            }
            default:
                throw new DomainException("Say what the safe entry is.");
        }

        safe.Add(entry);
        return entry;
    }

    private static FixedAsset NewAsset(SafeVoucher voucher, FixedAssetInput asset, Guid assetId, int number, CashFund fund, Guid paidBy, string by) =>
        new(assetId, number, asset.Name, asset.Category, asset.Location, asset.Notes, voucher.Date, voucher.Amount, asset.SalvageValue,
            asset.UsefulLifeMonths, fund, paidBy, by);

    // What would stop it being voided: a sold asset's purchase, before its sale is.
    public async Task CheckVoidAsync(SafeTransaction entry, CancellationToken cancellationToken)
    {
        if (entry.Kind == SafeTransactionKind.AssetPurchase && entry.FixedAssetId is { } assetId
            && await assets.GetByIdAsync(assetId, cancellationToken) is { Status: FixedAssetStatus.Sold } sold)
            throw new DomainException($"{sold.AssetCode} {sold.Name} is sold: void its sale first. · ألغِ بيع الأصل أولًا.");
    }

    private async Task<FixedAsset> AssetOnRegisterAsync(Guid? id, CancellationToken cancellationToken)
    {
        var asset = id is { } assetId
            ? await assets.GetByIdAsync(assetId, cancellationToken) ?? throw new NotFoundException("Fixed asset", assetId)
            : throw new DomainException("Choose the asset. · اختر الأصل.");
        return asset.IsVoided ? throw new DomainException("This asset is off the register. · الأصل محذوف من السجل.") : asset;
    }

    // Voids it, today: the opposite amount in the safe's ledger, and on the supplier's account too
    // for a supplier payment. A payment out of a day's takings goes back into the safe when they
    // are in it.
    public async Task VoidAsync(SafeTransaction entry, string by, CancellationToken cancellationToken)
    {
        await CheckVoidAsync(entry, cancellationToken);
        safe.Add(entry.Void(Guid.NewGuid(), Today, by, await TakingsInSafeAsync(entry.RevenueDate, cancellationToken)));
        // A fixed asset's purchase voided: off the register. Its sale voided: back in use.
        if (entry.FixedAssetId is { } assetId && await assets.GetByIdAsync(assetId, cancellationToken) is { IsVoided: false } asset)
        {
            if (entry.Kind == SafeTransactionKind.AssetPurchase)
                asset.Void(by);
            else if (entry.Kind == SafeTransactionKind.AssetSale && asset.SaleTransactionId == entry.Id)
                asset.Reinstate(by);
        }
        // An advance to an employee from HR: taken off their pay there too.
        if (entry.Kind == SafeTransactionKind.EmployeeAdvance)
            await hr.AdvanceAsync(entry, voided: true, cancellationToken);
        // A payroll payment: the run is owed again, and HR told so.
        if (entry.Kind == SafeTransactionKind.PayrollPayment && entry.PayrollRunId is { } runId && await payrollRuns.GetByIdAsync(runId, cancellationToken) is { } run)
        {
            run.Undisbursed();
            await hr.PayrollAsync(run, entry, voided: true, cancellationToken);
        }
        if (entry.Kind == SafeTransactionKind.SupplierPayment)
            foreach (var line in (await suppliersLedger.GetBySourceAsync(entry.Id, cancellationToken)).Where(l => !l.IsReversal))
                suppliersLedger.Add(line.Reverse(Today, by));
    }

    // A posted invoice's payment, as it was chosen: on credit, owed to the supplier at once (no
    // cash moves); in cash, entered for a manager and asked of one for anyone else. Returns the
    // request when it was asked.
    public async Task<ApprovalRequest?> SettleAsync(
        PurchaseInvoice invoice, Guid requestId, string staffId, string staffName, bool canApprove, IApprovalRequestRepository requests,
        CancellationToken cancellationToken)
    {
        // Nothing to pay; or a correction of an invoice from before the treasury, which touches
        // neither the safe nor a supplier's account.
        if (invoice.Total <= 0 || invoice.PaymentMethod == PurchasePaymentMethod.BeforeTreasury)
            return null;
        _posting[invoice.Id] = invoice;
        if (invoice.PaymentMethod == PurchasePaymentMethod.Credit)
        {
            suppliersLedger.Add(SupplierLedgerEntry.CreditInvoice(
                invoice.SupplierId!.Value, invoice.Id, invoice.Total, invoice.InvoiceDate ?? Today, staffName));
            return null;
        }

        // Paid today, or on the day of the takings it comes from when that is the calendar day
        // after midnight.
        var paidOn = invoice.RevenueDate > Today ? invoice.RevenueDate.Value : Today;
        var voucher = new SafeVoucher(
            Guid.NewGuid(), SafeTransactionKind.InvoicePayment, invoice.Total, paidOn, RevenueDate: invoice.RevenueDate, PurchaseInvoiceId: invoice.Id);
        if (canApprove)
        {
            await ApplyAsync(voucher, staffName, null, cancellationToken);
            return null;
        }

        await CheckAsync(voucher, cancellationToken);
        var (summary, changes) = await DescribeAsync(voucher, cancellationToken);
        var asked = ApprovalRequest.AskToChange(
            requestId, ApprovalModule.Treasury, ApprovalAction.Create, invoice.Id, summary, changes, ApprovalPayload.Write(voucher), null, staffId,
            staffName);
        requests.Add(asked);
        return asked;
    }

    // An invoice's cash payment and credit lines undone, for a voided invoice.
    public async Task UndoInvoiceAsync(PurchaseInvoice invoice, string by, CancellationToken cancellationToken)
    {
        if (await safe.GetPaymentOfInvoiceAsync(invoice.Id, cancellationToken) is { } payment)
            await VoidAsync(payment, by, cancellationToken);
        foreach (var line in (await suppliersLedger.GetBySourceAsync(invoice.Id, cancellationToken)).Where(l => !l.IsReversal))
            suppliersLedger.Add(line.Reverse(Today, by));
    }

    // "Supplier payment · Nile Farms · L.E 500.00 · 12 Oct 2026", for a request or a void; and what
    // it changes, line by line.
    public async Task<(string Summary, IReadOnlyList<ApprovalChange> Changes)> DescribeAsync(SafeVoucher voucher, CancellationToken cancellationToken)
    {
        var changes = new List<ApprovalChange> { new("Date", null, Day(voucher.Date)) };
        var amount = Money(voucher.Amount);
        string summary;
        switch (voucher.Kind)
        {
            case SafeTransactionKind.OpeningBalance:
            case SafeTransactionKind.Funding:
                var from = SourceName(voucher.Source);
                summary = $"{(voucher.Kind == SafeTransactionKind.OpeningBalance ? "Opening balance" : "Funding")} · {from} · {amount}";
                changes.Add(new ApprovalChange("Source", null, from));
                break;
            case SafeTransactionKind.RevenueTransfer:
            {
                var paidOut = await safe.PaidOutOfTakingsAsync(voucher.RevenueDate!.Value, cancellationToken);
                var (cash, card, tax) = Takings(voucher);
                summary = $"Takings of {Day(voucher.RevenueDate.Value)} · {Money(cash)} cash" + (card != 0 ? $", {Money(card)} card" : "") +
                    $" · net sales {Money(cash + card)}, {Money(cash + card + tax - paidOut)} into the safe";
                changes.Add(new ApprovalChange("Card · الفيزا", null, Money(card)));
                changes.Add(new ApprovalChange("Tax collected · الضريبة المحصلة", null, Money(tax)));
                changes.Add(new ApprovalChange("Net sales · صافي المبيعات", null, Money(cash + card)));
                if (voucher.VoidsAmount is > 0 and var voids)
                    changes.Add(new ApprovalChange("Voids and refunds · الفويد والمرتجعات", null, Money(voids)));
                if (voucher.DiscountsAmount is > 0 and var discounts)
                    changes.Add(new ApprovalChange("Discounts & promos · الخصومات والعروض", null,
                        Money(discounts) + (voucher.DiscountReasons is { Count: > 0 } why ? $" ({string.Join(", ", why.Select(r => r.Reason))})" : "")));
                changes.Add(new ApprovalChange("Paid out of them", null, Money(paidOut)));
                changes.Add(new ApprovalChange("Into the safe · إجمالي الوارد للخزنة", null, Money(cash + card + tax - paidOut)));
                break;
            }
            case SafeTransactionKind.ExpenseVoucher:
                var item = await ExpenseItemAsync(voucher.ExpenseItemId, cancellationToken);
                summary = $"Expense voucher · {item.Name} · {amount}";
                changes.Add(new ApprovalChange("Expense", null, item.Name));
                break;
            case SafeTransactionKind.TaxPayment:
            {
                var taxOwed = await safe.TaxOwedAsync(cancellationToken);
                summary = $"Tax payment · {amount}";
                changes.Add(new ApprovalChange("Tax owed · الضريبة المستحقة", Money(taxOwed), Money(taxOwed - voucher.Amount)));
                break;
            }
            case SafeTransactionKind.SupplierPayment:
                var supplier = await SupplierAsync(voucher.SupplierId, cancellationToken);
                var owed = await suppliersLedger.BalanceAsync(supplier.Id, cancellationToken);
                var paidFrom = voucher.RevenueDate is { } takings ? $"the takings of {Day(takings)}" : "the safe";
                summary = $"Supplier payment · {supplier.Name} · {amount}{(voucher.RevenueDate is null ? "" : $" from {paidFrom}")}";
                changes.Add(new ApprovalChange($"Owed to {supplier.Name}", Money(owed), Money(owed - voucher.Amount)));
                changes.Add(new ApprovalChange("Paid from", null, paidFrom));
                break;
            case SafeTransactionKind.InvoicePayment:
                var invoice = await UnpaidInvoiceAsync(voucher.PurchaseInvoiceId, cancellationToken);
                var name = invoice.SupplierId is { } id ? (await suppliers.GetByIdAsync(id, cancellationToken))?.Name : null;
                var fromWhere = invoice.RevenueDate is { } day ? $"the takings of {Day(day)}" : "the safe";
                summary = $"{(invoice.SupplierInvoiceNumber is { } number ? $"Invoice {number}" : "Invoice")}" +
                          $"{(name is null ? "" : $" · {name}")} paid from {fromWhere} · {Money(invoice.Total)}";
                changes.Add(new ApprovalChange("Paid from", null, fromWhere));
                break;
            case SafeTransactionKind.EmployeeAdvance when voucher.EmployeeId is null:
            {
                var advanceFrom = voucher.RevenueDate is { } advanceDay ? $"the takings of {Day(advanceDay)}" : "the safe";
                summary = $"Advances, not given out yet · {amount}{(voucher.RevenueDate is null ? "" : $" from {advanceFrom}")}";
                changes.Add(new ApprovalChange("Employee", null, "None named: shared among the staff"));
                changes.Add(new ApprovalChange("Paid from", null, advanceFrom));
                break;
            }
            case SafeTransactionKind.EmployeeAdvance:
            {
                var employee = await EmployeeAsync(voucher.EmployeeId, cancellationToken);
                var advanceFrom = voucher.RevenueDate is { } advanceDay ? $"the takings of {Day(advanceDay)}" : "the safe";
                summary = $"Employee advance · {employee.Name} · {amount}{(voucher.RevenueDate is null ? "" : $" from {advanceFrom}")}";
                changes.Add(new ApprovalChange("Employee", null, employee.Name));
                changes.Add(new ApprovalChange("Paid from", null, advanceFrom));
                changes.Add(new ApprovalChange("Deducted from the pay of", null, MonthName(PayMonthOf(voucher.Date))));
                break;
            }
            case SafeTransactionKind.SalaryPayment:
            {
                var (employee, month) = await SalaryAsync(voucher, cancellationToken);
                var salaryFrom = voucher.RevenueDate is { } salaryDay ? $"the takings of {Day(salaryDay)}" : "the safe";
                summary = $"Salary · {employee.Name} · {MonthName(month)} · {amount}{(voucher.RevenueDate is null ? "" : $" from {salaryFrom}")}";
                changes.Add(new ApprovalChange("Employee", null, employee.Name));
                changes.Add(new ApprovalChange("For the pay of", null, MonthName(month)));
                changes.Add(new ApprovalChange("Paid from", null, salaryFrom));
                break;
            }
            case SafeTransactionKind.PayrollPayment:
            {
                var run = await PayrollRunAsync(voucher.PayrollRunId, cancellationToken);
                summary = $"Payroll from HR · {run.PeriodName} · {amount}";
                changes.Add(new ApprovalChange("Payroll of", null, run.PeriodName));
                changes.Add(new ApprovalChange("Employees", null, run.Employees.ToString(Invariant)));
                changes.Add(new ApprovalChange("Advances already paid", null, Money(run.TotalAdvancesDeducted)));
                break;
            }
            case SafeTransactionKind.AssetPurchase:
            {
                var asset = voucher.Asset!;
                var monthly = Math.Round((voucher.Amount - asset.SalvageValue) / Math.Max(asset.UsefulLifeMonths, 1), 2, MidpointRounding.AwayFromZero);
                summary = $"Fixed asset bought (CAPEX) · {asset.Name} · {amount} from {FundName(voucher.Fund)}";
                changes.Add(new ApprovalChange("Asset · الأصل", null, asset.Name));
                changes.Add(new ApprovalChange("Category · الفئة", null, CategoryName(asset.Category)));
                changes.Add(new ApprovalChange("Useful life · العمر الإنتاجي", null, $"{asset.UsefulLifeMonths} months"));
                changes.Add(new ApprovalChange("Salvage value · القيمة التخريدية", null, Money(asset.SalvageValue)));
                changes.Add(new ApprovalChange("Monthly depreciation · قسط الإهلاك الشهري", null, Money(monthly)));
                changes.Add(new ApprovalChange("Paid from", null, FundName(voucher.Fund)));
                break;
            }
            case SafeTransactionKind.AssetSale:
            {
                var sold = await AssetOnRegisterAsync(voucher.FixedAssetId, cancellationToken);
                var left = sold.NetBookValueThrough(voucher.Date.AddMonths(-1));
                summary = $"Fixed asset sold · {sold.AssetCode} {sold.Name} · {amount} into {FundName(voucher.Fund)}";
                changes.Add(new ApprovalChange("Asset · الأصل", null, $"{sold.AssetCode} {sold.Name}"));
                changes.Add(new ApprovalChange("Net book value · القيمة الدفترية", null, Money(left)));
                changes.Add(new ApprovalChange(voucher.Amount >= left ? "Gain on sale · ربح البيع" : "Loss on sale · خسارة البيع", null,
                    Money(Math.Abs(voucher.Amount - left))));
                changes.Add(new ApprovalChange("Paid into", null, FundName(voucher.Fund)));
                break;
            }
            default:
                throw new DomainException("Say what the safe entry is.");
        }

        changes.Insert(1, voucher.Kind == SafeTransactionKind.RevenueTransfer
            ? new ApprovalChange("Cash · الكاش", null, Money(Takings(voucher).Cash))
            : new ApprovalChange("Amount", null, amount));
        // What the safe holds after it: a payment out of a day's takings moves it once they are in it.
        var fromDrawer = voucher.RevenueDate is not null && SafeTransaction.PaidOutKinds.Contains(voucher.Kind)
            && !await TakingsInSafeAsync(voucher.RevenueDate, cancellationToken);
        decimal? moves = voucher.Kind switch
        {
            _ when fromDrawer => null,
            // Through the bank: the safe does not move.
            _ when voucher.Fund == CashFund.Bank => null,
            SafeTransactionKind.OpeningBalance or SafeTransactionKind.Funding or SafeTransactionKind.AssetSale => voucher.Amount,
            SafeTransactionKind.RevenueTransfer => Takings(voucher) is var (cash, card, tax)
                ? cash + card + tax - await safe.PaidOutOfTakingsAsync(voucher.RevenueDate!.Value, cancellationToken)
                : 0,
            _ => -voucher.Amount,
        };
        if (moves is { } by)
        {
            var balance = await safe.SafeBalanceAsync(null, cancellationToken);
            changes.Add(new ApprovalChange("Safe", Money(balance), Money(balance + by)));
        }

        if (!string.IsNullOrWhiteSpace(voucher.Notes))
            changes.Add(new ApprovalChange("Notes", null, voucher.Notes.Trim()));
        return (summary, changes);
    }

    // The same, for an entry already made: what voiding it is about.
    public async Task<string> DescribeAsync(SafeTransaction entry, CancellationToken cancellationToken)
    {
        var what = entry.Kind switch
        {
            SafeTransactionKind.OpeningBalance => $"Opening balance · {SourceName(entry.Source)}",
            SafeTransactionKind.Funding => $"Funding · {SourceName(entry.Source)}",
            SafeTransactionKind.RevenueTransfer => $"Takings of {Day(entry.RevenueDate!.Value)} · {Money(entry.GrossAmount ?? entry.Amount)} cash" +
                (entry.CardAmount != 0 ? $", {Money(entry.CardAmount)} card" : "") + (entry.TaxAmount != 0 ? $", {Money(entry.TaxAmount)} tax" : ""),
            SafeTransactionKind.ExpenseVoucher => $"Expense voucher · {(entry.ExpenseItemId is { } e ? (await expenses.GetByIdAsync(e, cancellationToken))?.Name : null) ?? "an expense"}",
            SafeTransactionKind.TaxPayment => "Tax payment",
            SafeTransactionKind.SupplierPayment => $"Supplier payment · {(entry.SupplierId is { } s ? (await suppliers.GetByIdAsync(s, cancellationToken))?.Name : null) ?? "a supplier"}" +
                (entry.RevenueDate is { } paidFrom ? $" from the takings of {Day(paidFrom)}" : ""),
            SafeTransactionKind.EmployeeAdvance when entry.EmployeeId is null => "Advances, not given out yet" + From(entry.RevenueDate),
            SafeTransactionKind.EmployeeAdvance => $"Employee advance · {await EmployeeNameAsync(entry.EmployeeId, cancellationToken)}" + From(entry.RevenueDate),
            SafeTransactionKind.SalaryPayment => $"Salary · {await EmployeeNameAsync(entry.EmployeeId, cancellationToken)}" +
                (entry.PayrollMonth is { } month ? $" · {MonthName(month)}" : "") + From(entry.RevenueDate),
            SafeTransactionKind.PayrollPayment => $"Payroll from HR · {(entry.PayrollMonth is { } paid ? MonthName(paid) : "a month")}",
            SafeTransactionKind.AssetPurchase => $"Fixed asset bought · {await AssetNameAsync(entry.FixedAssetId, cancellationToken)} from {FundName(entry.Fund)}",
            SafeTransactionKind.AssetSale => $"Fixed asset sold · {await AssetNameAsync(entry.FixedAssetId, cancellationToken)} into {FundName(entry.Fund)}",
            _ => $"Invoice payment from {(entry.RevenueDate is { } day ? $"the takings of {Day(day)}" : "the safe")}",
        };
        return $"{what} · {Money(Math.Abs(entry.Amount))} · {Day(entry.BusinessDate)}";
    }

    // The pay an advance paid on `date` comes off: its month's. The pay itself is worked out in
    // the HR system.
    public static DateOnly PayMonthOf(DateOnly date) => new(date.Year, date.Month, 1);

    // A salary's employee and the month whose pay it is: paid as entered, the pay itself being
    // the HR system's.
    private async Task<(StaffMember Employee, DateOnly Month)> SalaryAsync(SafeVoucher voucher, CancellationToken cancellationToken)
    {
        var employee = await EmployeeAsync(voucher.EmployeeId, cancellationToken);
        var month = voucher.PayrollMonth is { } chosen
            ? (chosen.Day == 1 ? chosen : throw new DomainException("A pay month is named by its first day."))
            : throw new DomainException("Choose the month whose pay this is.");
        return (employee, month);
    }

    // A payroll run from HR still to be paid.
    private async Task<PayrollRun> PayrollRunAsync(Guid? id, CancellationToken cancellationToken)
    {
        var run = id is { } runId
            ? await payrollRuns.GetByIdAsync(runId, cancellationToken) ?? throw new NotFoundException("Payroll run", runId)
            : throw new DomainException("Choose the payroll run to pay.");
        return run.IsDisbursed ? throw new DomainException($"The payroll of {run.PeriodName} is paid already. · المسير مصروف بالفعل.") : run;
    }

    private async Task<StaffMember> EmployeeAsync(Guid? id, CancellationToken cancellationToken) =>
        id is { } employeeId
            ? await employees.GetByIdAsync(employeeId, cancellationToken) ?? throw new NotFoundException("Staff member", employeeId)
            : throw new DomainException("Choose the employee.");

    private async Task<string> EmployeeNameAsync(Guid? id, CancellationToken cancellationToken) =>
        (id is { } employeeId ? (await employees.GetByIdAsync(employeeId, cancellationToken))?.Name : null) ?? "an employee";

    private async Task<string> AssetNameAsync(Guid? id, CancellationToken cancellationToken) =>
        (id is { } assetId && await assets.GetByIdAsync(assetId, cancellationToken) is { } asset ? $"{asset.AssetCode} {asset.Name}" : null) ?? "an asset";

    private static string FundName(CashFund? fund) => fund == CashFund.Bank ? "the bank" : "the safe";

    private static string CategoryName(FixedAssetCategory category) => TreasuryNames.Category(category);

    private static string From(DateOnly? revenueDate) => revenueDate is { } day ? $" from the takings of {Day(day)}" : "";

    private static string MonthName(DateOnly month) => month.ToString("MMMM yyyy", Invariant);

    // Whether a day's takings are entered, and so in the safe: what is paid out of them, or put
    // back, moves the safe.
    private async Task<bool> TakingsInSafeAsync(DateOnly? revenueDate, CancellationToken cancellationToken) =>
        revenueDate is { } day && await safe.GetTakingsAsync(day, cancellationToken) is not null;

    private async Task<Supplier> SupplierAsync(Guid? id, CancellationToken cancellationToken) =>
        id is { } supplierId
            ? await suppliers.GetByIdAsync(supplierId, cancellationToken) ?? throw new NotFoundException(nameof(Supplier), supplierId)
            : throw new DomainException("Choose the supplier.");

    private async Task<ExpenseItem> ExpenseItemAsync(Guid? id, CancellationToken cancellationToken)
    {
        if (id is not { } itemId)
            throw new DomainException("Choose what the expense is.");
        var item = await expenses.GetByIdAsync(itemId, cancellationToken) ?? throw new NotFoundException(nameof(ExpenseItem), itemId);
        return item.IsArchived ? throw new DomainException($"{item.Name} is archived. Restore it on the Expense items tab to use it again.") : item;
    }

    // A posted invoice paid in cash and not paid yet.
    private async Task<PurchaseInvoice> UnpaidInvoiceAsync(Guid? id, CancellationToken cancellationToken)
    {
        if (id is not { } invoiceId)
            throw new DomainException("Choose the invoice.");
        var invoice = _posting.GetValueOrDefault(invoiceId)
            ?? await invoices.GetByIdAsync(invoiceId, cancellationToken)
            ?? throw new NotFoundException(nameof(PurchaseInvoice), invoiceId);
        if (invoice.Status != PurchaseInvoiceStatus.Posted)
            throw new DomainException(invoice.Status == PurchaseInvoiceStatus.Voided ? "This invoice has been voided." : "Post the invoice first.");
        if (invoice.PaymentMethod is not (PurchasePaymentMethod.Safe or PurchasePaymentMethod.DayRevenue))
            throw new DomainException("This invoice is not paid in cash.");
        if (await safe.GetPaymentOfInvoiceAsync(invoice.Id, cancellationToken) is not null)
            throw new DomainException("This invoice has already been paid.");
        return invoice;
    }

    private static string SourceName(FundingSource? source) => source switch
    {
        FundingSource.CarriedOver => "carried over",
        FundingSource.OwnerFinancing => "owners' financing",
        _ => "other source",
    };

    private static string Money(decimal value) => CompanyMoney.Text(value);

    // A day's takings as the safe will keep them: the cash and card before tax, and the tax on them.
    private static (decimal Cash, decimal Card, decimal Tax) Takings(SafeVoucher voucher) =>
        SafeTransaction.Takings(voucher.Amount, voucher.CardAmount ?? 0, voucher.TaxAmount, voucher.IncludesTax ? voucher.TaxPercent : null);

    private static string Day(DateOnly day) => day.ToString("d MMM yyyy", Invariant);
}

// How the treasury names a fixed asset's category, in both languages.
public static class TreasuryNames
{
    public static string Category(FixedAssetCategory category) => category switch
    {
        FixedAssetCategory.KitchenEquipment => "Kitchen equipment · معدات المطبخ",
        FixedAssetCategory.Furniture => "Furniture · الأثاث",
        FixedAssetCategory.Vehicles => "Vehicles · السيارات",
        FixedAssetCategory.ItAndPos => "IT & POS · أجهزة الحاسب ونقاط البيع",
        FixedAssetCategory.FitOut => "Fit-out & decoration · تجهيزات وديكورات",
        _ => "Other · أخرى",
    };
}

// A safe entry: entered at once for a manager (Transaction), asked of a manager for anyone else
// (Request). RequestId is made by the till: a retry finds what was made.
public sealed record RecordSafeVoucherCommand(
    Guid RequestId, SafeVoucher Voucher, string? Reason, string StaffId, string StaffName, bool CanApprove)
    : IRequest<SafeVoucherResultDto>, IRetryOnConflict;

public sealed record SafeVoucherResultDto(ApprovalOutcome Outcome, SafeTransactionDto? Transaction, ApprovalRequestDto? Request);

internal sealed class RecordSafeVoucherHandler(
    TreasuryWriter treasury,
    ISafeTransactionRepository safe,
    IApprovalRequestRepository requests,
    IUnitOfWork unitOfWork) : IRequestHandler<RecordSafeVoucherCommand, SafeVoucherResultDto>
{
    public async Task<SafeVoucherResultDto> Handle(RecordSafeVoucherCommand request, CancellationToken cancellationToken)
    {
        if (await safe.GetByIdAsync(request.Voucher.TransactionId, cancellationToken) is { } made)
            return new SafeVoucherResultDto(ApprovalOutcome.Applied, SafeTransactionDto.From(made), null);
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is { } already)
            return new SafeVoucherResultDto(ApprovalOutcome.Requested, null, ApprovalRequestDto.From(already));
        if (request.Voucher.Kind == SafeTransactionKind.InvoicePayment)
            throw new DomainException("An invoice is paid from the invoice itself.");
        if (request.Voucher.Kind == SafeTransactionKind.PayrollPayment)
            throw new DomainException("A payroll from HR is paid from Financials → Staff → Payroll from HR.");
        var voucher = await treasury.WithTaxRateAsync(request.Voucher, cancellationToken);

        if (request.CanApprove)
        {
            var entry = await treasury.ApplyAsync(voucher, request.StaffName, null, cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
            return new SafeVoucherResultDto(ApprovalOutcome.Applied, SafeTransactionDto.From(entry), null);
        }

        await treasury.CheckAsync(voucher, cancellationToken);
        var (summary, changes) = await treasury.DescribeAsync(voucher, cancellationToken);
        var asked = ApprovalRequest.AskToChange(
            request.RequestId, ApprovalModule.Treasury, ApprovalAction.Create, voucher.TransactionId, summary, changes,
            ApprovalPayload.Write(voucher), request.Reason, request.StaffId, request.StaffName);
        requests.Add(asked);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new SafeVoucherResultDto(ApprovalOutcome.Requested, null, ApprovalRequestDto.From(asked));
    }
}

// What a supplier was owed when the treasury started, from invoices before it. No cash moves, so
// it is entered at once. EntryId is made by the till.
public sealed record SetSupplierOpeningBalanceCommand(Guid EntryId, Guid SupplierId, decimal Owed, DateOnly Date, string StaffName)
    : IRequest, IRetryOnConflict;

internal sealed class SetSupplierOpeningBalanceHandler(
    ISupplierLedgerRepository ledger, ISupplierRepository suppliers, IUnitOfWork unitOfWork)
    : IRequestHandler<SetSupplierOpeningBalanceCommand>
{
    public async Task Handle(SetSupplierOpeningBalanceCommand request, CancellationToken cancellationToken)
    {
        if (await ledger.GetByIdAsync(request.EntryId, cancellationToken) is not null)
            return;
        _ = await suppliers.GetByIdAsync(request.SupplierId, cancellationToken) ?? throw new NotFoundException(nameof(Supplier), request.SupplierId);
        ledger.Add(SupplierLedgerEntry.Opening(request.EntryId, request.SupplierId, request.Owed, request.Date, request.StaffName));
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}

// Where an invoice's payment stands, for the screens.
public enum InvoicePaymentStatus
{
    // A draft: nothing is due yet.
    NotPosted = 1,

    // Paid in cash, from the safe or a day's takings.
    Paid = 2,

    // Its cash payment waits for a manager's approval.
    Pending = 3,

    // To be paid in cash, and not paid: its payment was rejected or voided.
    Unpaid = 4,

    // Owed to its supplier: see the supplier's account for what is paid.
    OnCredit = 5,

    // Posted before the treasury was kept.
    BeforeTreasury = 6,
}

public static class InvoicePayments
{
    public static InvoicePaymentStatus StatusOf(PurchaseInvoice invoice, bool paid, bool pending) => invoice switch
    {
        { Status: PurchaseInvoiceStatus.Draft } => InvoicePaymentStatus.NotPosted,
        { PaymentMethod: PurchasePaymentMethod.Credit } => InvoicePaymentStatus.OnCredit,
        { PaymentMethod: PurchasePaymentMethod.BeforeTreasury or null } => InvoicePaymentStatus.BeforeTreasury,
        _ when paid => InvoicePaymentStatus.Paid,
        _ when pending => InvoicePaymentStatus.Pending,
        { Total: <= 0 } => InvoicePaymentStatus.Paid,
        _ => InvoicePaymentStatus.Unpaid,
    };

    public static async Task<InvoicePaymentStatus> StatusAsync(
        PurchaseInvoice invoice, ISafeTransactionRepository safe, IApprovalRequestRepository requests, CancellationToken cancellationToken) =>
        StatusOf(
            invoice,
            await safe.GetPaymentOfInvoiceAsync(invoice.Id, cancellationToken) is not null,
            await requests.GetPendingForAsync(invoice.Id, cancellationToken) is { Module: ApprovalModule.Treasury });
}

// Pays a posted cash invoice that is not paid (its payment was rejected or voided): from the safe
// or a day's takings, for a manager at once and asked of one for anyone else; or onto credit,
// owed to its supplier.
public sealed record PayPurchaseInvoiceCommand(
    Guid RequestId, Guid InvoiceId, PurchasePaymentMethod Method, DateOnly? RevenueDate, string StaffId, string StaffName, bool CanApprove)
    : IRequest<InvoicePaymentStatus>, IRetryOnConflict;

internal sealed class PayPurchaseInvoiceHandler(
    IPurchaseInvoiceRepository invoices,
    ISafeTransactionRepository safe,
    IApprovalRequestRepository requests,
    TreasuryWriter treasury,
    IUnitOfWork unitOfWork) : IRequestHandler<PayPurchaseInvoiceCommand, InvoicePaymentStatus>
{
    public async Task<InvoicePaymentStatus> Handle(PayPurchaseInvoiceCommand request, CancellationToken cancellationToken)
    {
        var invoice = await invoices.GetRequiredAsync(request.InvoiceId, cancellationToken);
        if (await requests.GetByIdAsync(request.RequestId, cancellationToken) is not null)
            return await InvoicePayments.StatusAsync(invoice, safe, requests, cancellationToken);
        var status = await InvoicePayments.StatusAsync(invoice, safe, requests, cancellationToken);
        if (status != InvoicePaymentStatus.Unpaid)
            throw new DomainException(status switch
            {
                InvoicePaymentStatus.Paid => "This invoice has already been paid.",
                InvoicePaymentStatus.Pending => "This invoice's payment is waiting for a manager's approval.",
                InvoicePaymentStatus.OnCredit => "This invoice is on credit: pay the supplier with a payment voucher.",
                _ => "This invoice is not one to pay here.",
            });

        invoice.PayBy(request.Method, request.RevenueDate);
        await treasury.SettleAsync(invoice, request.RequestId, request.StaffId, request.StaffName, request.CanApprove, requests, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return await InvoicePayments.StatusAsync(invoice, safe, requests, cancellationToken);
    }
}
```


### 1.5 التقارير: `TreasuryService`

الدفتر بشهر (`SafeMonth`: الكاش، الفيزا، الضريبة، الصافي، التمويل، إجمالي الداخل والخارج، **الضريبة المستحقة الآن**)، مصادر التمويل، **المطابقة** (`DayRevenue`: صافي مبيعات اليوم A مقابل قيمة مبيعاته بأسعار المنيو B؛ الفرق خصومات أو وجبات موظفين أو كاش ناقص، أو أصناف لم تُدخل)، **يومية الإيراد** (إجمالي اليوم ناقص ما دُفع من درجه مباشرة = ما وصل الخزنة)، وتحليلات الخزنة لأي فترة (من أين جاء المال وأين ذهب، ونسب المدفوع من الدرج لكل نوع).

> 📄 **`backend/src/Costing.Infrastructure/Reports/TreasuryService.cs`** — 962 سطر

```csharp
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Sales;
using Costing.Domain.Purchases;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// One line of the safe's ledger as the screens show it: what it was, in or out, and the balance
// after it. A reversal names what it undid (ReversalOf); what it undid is marked voided.
public sealed record SafeEntryRow(
    Guid Id,
    SafeTransactionKind Kind,
    CashFund Fund,
    DateOnly Date,
    string Description,
    decimal In,
    decimal Out,
    decimal? Balance,
    FundingSource? Source,
    DateOnly? RevenueDate,
    Guid? SupplierId,
    Guid? PurchaseInvoiceId,
    Guid? ExpenseItemId,
    string? Notes,
    string RecordedBy,
    DateTime RecordedAtUtc,
    string? ApprovedBy,
    Guid? ReversalOf,
    DateTime? VoidedAtUtc,
    string? VoidedBy,
    // A day's takings: the tax collected on them, and the till's rate when it was worked out at it
    // (signed as In and Out are: a voided entry's reversal takes it back).
    bool IncludesTax = false,
    decimal? TaxPercent = null,
    decimal Tax = 0,
    // A day's takings: their cash and card sales before tax, as entered; In is what of all of it,
    // tax too, reached the safe. And the day's voids and refunds, said.
    decimal? Gross = null,
    decimal Card = 0,
    decimal Voids = 0);

// How a month's opening balance came about: carried over from the month before (رصيد مرحل), the
// treasury's own opening entry, made this month, or none yet.
public enum SafeOpening
{
    None = 0,
    CarriedOver = 1,
    OpeningEntry = 2,
}

// The safe in one month: the balance it opened with and why, what came in and went out, the
// balance it closed with; and the balance now. The summary strip reads in order: the month's cash,
// card and tax takings; all that came in, with the balance it opened with and the funding put in
// (FundingIn); all that went out, what was paid straight out of the takings too; then the balance
// now and the month's closing balance (TotalIn − TotalOut).
public sealed record SafeMonth(
    int Year,
    int Month,
    DateOnly From,
    DateOnly To,
    decimal OpeningBalance,
    SafeOpening OpeningKind,
    // The opening entry's source, when the treasury opened this month.
    FundingSource? OpeningSource,
    // What stands: an entry voided this month, and its void, are in neither.
    decimal In,
    decimal Out,
    // The entries voided this month, money in and money out: left out of In and Out with their voids.
    decimal VoidedIn,
    decimal VoidedOut,
    decimal ClosingBalance,
    decimal BalanceNow,
    bool HasOpeningBalance,
    IReadOnlyList<SafeEntryRow> Entries,
    decimal CashTakings = 0,
    decimal CardTakings = 0,
    decimal TaxCollected = 0,
    decimal NetSales = 0,
    decimal FundingIn = 0,
    decimal TotalIn = 0,
    decimal TotalOut = 0,
    // The tax held in the safe for the tax authority now: collected, less what was paid over.
    decimal TaxOwedNow = 0,
    // Fixed assets sold for cash into the safe in the month (in TotalIn), and bought out of it (in TotalOut).
    decimal AssetSales = 0,
    decimal AssetPurchases = 0);

// The tax the takings collected and what was paid over of it (سداد ضرائب): what is still owed,
// held in the safe for it. Below zero, more was paid than these takings collected.
public sealed record TaxPosition(decimal Collected, decimal Paid, decimal Owed);

// One line of the treasury's analysis (تحليل الخزنة): where money came from or went, its share of
// all of it, and what it is made of (the expense vouchers by category, say).
public sealed record TreasuryFlowLine(string Key, string En, string? Ar, decimal Amount, decimal? SharePercent, IReadOnlyList<TreasuryFlowLine> Items);

// One business day of the safe: what came in and went out, the net, the balance it ended with, and
// the voids and refunds its takings said, with why.
public sealed record TreasuryDay(DateOnly Date, decimal In, decimal Out, decimal Net, decimal Balance, decimal Voids, IReadOnlyList<string> VoidReasons);

// The safe over a period (تحليل الخزنة والتدفقات النقدية): the balance it opened with, all that came
// in (that balance too) by where it came from, all that went out by what it paid for, what is left;
// the tax collected and paid over in the period and, to its last day, still owed; and day by day.
// What stands: an entry voided in the period and its void are in neither.
public sealed record TreasuryAnalytics(
    DateOnly From,
    DateOnly To,
    decimal OpeningBalance,
    decimal TotalIn,
    decimal TotalOut,
    decimal NetFlow,
    decimal ClosingBalance,
    IReadOnlyList<TreasuryFlowLine> Inflows,
    IReadOnlyList<TreasuryFlowLine> Outflows,
    decimal TaxCollected,
    decimal TaxPaid,
    TaxPosition TaxToDate,
    decimal Voids,
    IReadOnlyList<TreasuryDay> Days);

// Money put into the safe, by where it came from, over a period.
public sealed record FundingReport(
    DateOnly From,
    DateOnly To,
    decimal CarriedOver,
    decimal OwnerFinancing,
    decimal Other,
    decimal Revenue,
    decimal Total,
    IReadOnlyList<SafeEntryRow> Entries);

// One business day's takings as its Z report gave them: the cash and the card before tax, and so
// the net sales (Cash + Card), and the tax collected on them; the voids, said; what was paid
// straight out of them, and what of them is in the safe. Entered: the takings are; HasSales: the
// day's sales are.
public sealed record DayRevenue(
    DateOnly Date, decimal Cash, decimal Card, decimal Tax, decimal NetSales, decimal Voids, decimal PaidOut, decimal Transferred, bool Entered,
    bool HasSales);

public sealed record DayRevenueReport(
    DateOnly From, DateOnly To, decimal Cash, decimal Card, decimal Tax, decimal NetSales, decimal Voids, decimal PaidOut, decimal Transferred,
    IReadOnlyList<DayRevenue> Days);

// Each day's takings as they were spent (يومية الإيراد): the gross entered for them (Gross), the
// invoices paid straight out of them (Deductions), and what is left of them in the safe
// (NetToSafe). A line is one invoice paid, with what it bought, the dearest first; or the takings
// entered, at their gross.
public sealed record DailyCashLine(
    Guid Id, SafeTransactionKind Kind, DateOnly Date, string Description, decimal Amount, Guid? PurchaseInvoiceId, IReadOnlyList<string> Items,
    string RecordedBy, string? ApprovedBy);

public sealed record DailyCashDay(
    DateOnly Date, decimal Gross, decimal Deductions, decimal NetToSafe, IReadOnlyList<DailyCashLine> Paid, IReadOnlyList<DailyCashLine> Entered);

// A day's takings as they stand before they are entered: the gross already entered for them, if
// any; and what was paid straight out of them, invoices and supplier payments, which entering them
// takes off.
public sealed record TakingsPreview(DateOnly Date, decimal? Entered, decimal PaidOut, int Invoices, int SupplierPayments, int EmployeePayments = 0);

public sealed record DailyCashReport(DateOnly From, DateOnly To, decimal Gross, decimal Deductions, decimal NetToSafe, IReadOnlyList<DailyCashDay> Days);

// A tax payment (IsTaxPayment) is listed with the vouchers, with no expense item: not an expense.
public sealed record ExpenseVoucherRow(
    Guid Id, DateOnly Date, Guid? ExpenseItemId, string ExpenseItem, string? Category, decimal Amount, string? Notes, string RecordedBy, string? ApprovedBy,
    DateTime? VoidedAtUtc, string? VoidedBy, bool IsTaxPayment = false);

// Total: the expenses; TaxPaid: the tax paid over, apart.
public sealed record ExpenseVoucherReport(DateOnly From, DateOnly To, decimal Total, IReadOnlyList<ExpenseVoucherRow> Vouchers, decimal TaxPaid = 0);

// What is owed to one supplier, and how it came about.
public sealed record SupplierBalance(
    Guid SupplierId, string Supplier, bool IsArchived, decimal OpeningDebt, decimal CreditPurchases, decimal Payments, decimal Balance,
    DateOnly? LastPaidOn, int OpenInvoices);

// A line of a supplier's statement (كشف حساب): Owed adds to the debt, Paid takes from it.
public sealed record SupplierStatementLine(
    Guid Id, DateOnly Date, SupplierLedgerKind Kind, string Description, decimal Owed, decimal Paid, decimal Balance, Guid SourceId, bool IsReversal);

public enum OpenInvoiceStatus
{
    Unpaid = 1,
    PartlyPaid = 2,
}

// A credit invoice not fully paid: payments are set against the opening debt first, then the
// invoices oldest first.
public sealed record OpenInvoice(
    Guid InvoiceId, string? SupplierInvoiceNumber, DateOnly Date, decimal Total, decimal Paid, decimal Remaining, OpenInvoiceStatus Status);

public sealed record SupplierStatement(
    Guid SupplierId,
    string Supplier,
    decimal OpeningDebt,
    decimal CreditPurchases,
    decimal Payments,
    decimal Balance,
    IReadOnlyList<SupplierStatementLine> Lines,
    IReadOnlyList<OpenInvoice> OpenInvoices);

// FromTakingsOf: paid straight out of that day's takings, not the safe.
public sealed record SupplierPaymentRow(
    Guid Id, DateOnly Date, Guid SupplierId, string Supplier, decimal Amount, string? Notes, string RecordedBy, string? ApprovedBy,
    DateTime? VoidedAtUtc, string? VoidedBy, DateOnly? FromTakingsOf = null);

// An employee's advance (سلفة): when and from where it was paid, and the payroll month whose slip
// deducts it.
// No employee and no payroll month: advances handed out with no one named, given out on HR →
// Advances.
public sealed record AdvanceRow(
    Guid Id, DateOnly Date, Guid? EmployeeId, string Employee, decimal Amount, DateOnly? PayrollMonth, DateOnly? FromTakingsOf, string? Notes,
    string RecordedBy, string? ApprovedBy, DateTime? VoidedAtUtc, string? VoidedBy);

// Tax and service (إعدادات الضريبة والخدمة): the till's tax rate, as the delivery system set it (null
// until it has synced, when the till cannot price a bill either), and the service charge.
public sealed record FinancialSettingsDto(decimal? TaxPercent, decimal ServicePercent, string? UpdatedBy, DateTime? UpdatedAtUtc);

// The tax rate left out of a save stays as it is.
public sealed record SaveFinancialSettingsRequest(decimal ServicePercent, decimal? TaxPercent = null);

// One business day of the reconciliation (مطابقة الإيرادات), or the period's total (no Date).
//
// The takings (A): the day's cash and card as its Z report gave them, before the tax collected on
// them: its net sales. The sales (B): every item of the day's sales summary at its menu price,
// before tax (a bill entered as printed: what it charged before tax, less what was handed back).
//
// Difference: A less B. Below zero, the takings fall short of what was sold at the menu's prices
// (discounts, staff meals, cash missing); above it, money came in for items not entered.
public sealed record ReconciliationDay(
    DateOnly? Date,
    decimal Cash,
    decimal Card,
    decimal Tax,
    decimal NetSales,
    decimal Voids,
    decimal ItemSales,
    decimal Difference);

public sealed record ReconciliationReport(DateOnly From, DateOnly To, decimal? TaxPercent, ReconciliationDay Total, IReadOnlyList<ReconciliationDay> Days);

// The treasury's reports, read straight from the ledgers: the safe, where its money came from, each
// day's cash and its reconciliation with the sales, the expense vouchers, and what is owed to
// suppliers. And its tax and service settings.
public sealed class TreasuryService(CostingDbContext db, IBusinessCalendar clock, SalesLedger ledger)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public DateOnly Today => clock.BusinessDateOf(DateTime.UtcNow);

    // ---- The safe ----

    public async Task<SafeMonth> GetSafeAsync(int year, int month, CancellationToken cancellationToken)
    {
        if (month is < 1 or > 12 || year is < 2000 or > 2100)
            throw new DomainException("Choose a month.");
        var from = new DateOnly(year, month, 1);
        var to = from.AddMonths(1).AddDays(-1);

        var safe = db.SafeTransactions.AsNoTracking().Where(t => t.Fund == CashFund.Safe);
        var before = await safe.Where(t => t.BusinessDate < from).SumAsync(t => t.Amount, cancellationToken);
        var anyBefore = await safe.AnyAsync(t => t.BusinessDate < from, cancellationToken);
        var rows = await safe.Where(t => t.BusinessDate >= from && t.BusinessDate <= to)
            .OrderBy(t => t.BusinessDate).ThenBy(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var opening = rows.FirstOrDefault(t => t.Kind == SafeTransactionKind.OpeningBalance && !t.IsReversal);

        // An entry and its void, both this month, come to nothing: In and Out count neither, and
        // the entry is shown apart as voided. An earlier month's entry voided this month stays in
        // that month, which closed with it, and its void counts here, where it was made.
        var ids = rows.Select(t => t.Id).ToHashSet();
        var cancelled = rows.Where(t => t.ReversalOf is { } original && ids.Contains(original))
            .SelectMany(t => new[] { t.Id, t.ReversalOf!.Value })
            .ToHashSet();
        var standing = rows.Where(t => !cancelled.Contains(t.Id)).ToList();
        var voided = rows.Where(t => cancelled.Contains(t.Id) && !t.IsReversal).ToList();

        var names = await NamesAsync(rows, cancellationToken);
        var balance = before;
        var entries = rows.Select(t =>
        {
            balance += t.Amount;
            return Row(t, names, balance);
        }).ToList();

        var takings = standing.Where(t => t.Kind == SafeTransactionKind.RevenueTransfer).ToList();
        var (cash, card, tax) = (takings.Sum(t => t.GrossAmount ?? t.Amount), takings.Sum(t => t.CardAmount), takings.Sum(t => t.TaxAmount));
        var funding = standing.Where(t => t.Kind is SafeTransactionKind.OpeningBalance or SafeTransactionKind.Funding).Sum(t => t.Amount);
        var assetSales = standing.Where(t => t.Kind == SafeTransactionKind.AssetSale).Sum(t => t.Amount);
        return new SafeMonth(
            year, month, from, to, Money(before),
            anyBefore ? SafeOpening.CarriedOver : opening is not null ? SafeOpening.OpeningEntry : SafeOpening.None,
            anyBefore ? null : opening?.Source,
            Money(standing.Where(t => t.Amount > 0).Sum(t => t.Amount)),
            Money(-standing.Where(t => t.Amount < 0).Sum(t => t.Amount)),
            Money(voided.Where(t => t.Amount > 0).Sum(t => t.Amount)),
            Money(-voided.Where(t => t.Amount < 0).Sum(t => t.Amount)),
            Money(balance),
            Money(await safe.SumAsync(t => t.Amount, cancellationToken)),
            await db.SafeTransactions.AnyAsync(t => t.Kind == SafeTransactionKind.OpeningBalance && t.ReversalOf == null && t.VoidedAtUtc == null, cancellationToken),
            entries,
            Money(cash), Money(card), Money(tax), Money(cash + card), Money(funding),
            Money(before + cash + card + tax + funding + assetSales),
            Money(Out(standing)),
            (await GetTaxPositionAsync(null, cancellationToken)).Owed,
            Money(assetSales), Money(-standing.Where(t => t.Kind == SafeTransactionKind.AssetPurchase).Sum(t => t.Amount)));
    }

    // All that went out of the safe in these entries: what was paid from it (a voided payment's void
    // taking it back), and what the takings had paid straight out of them before they went in.
    private static decimal Out(IEnumerable<SafeTransaction> entries) =>
        entries.Sum(t => t.Kind switch
        {
            SafeTransactionKind.RevenueTransfer => t.TakingsTotal - t.Amount,
            SafeTransactionKind.OpeningBalance or SafeTransactionKind.Funding or SafeTransactionKind.AssetSale => 0,
            _ => -t.Amount,
        });

    // ---- The tax held for the tax authority ----

    // The tax the takings collected and what was paid over, up to and including `through`, or ever.
    // A voided entry nets out with its void.
    public async Task<TaxPosition> GetTaxPositionAsync(DateOnly? through, CancellationToken cancellationToken)
    {
        var entries = db.SafeTransactions.AsNoTracking()
            .Where(t => (t.Kind == SafeTransactionKind.RevenueTransfer || t.Kind == SafeTransactionKind.TaxPayment) && (through == null || t.BusinessDate <= through));
        var collected = await entries.Where(t => t.Kind == SafeTransactionKind.RevenueTransfer).SumAsync(t => t.TaxAmount, cancellationToken);
        var paid = -await entries.Where(t => t.Kind == SafeTransactionKind.TaxPayment).SumAsync(t => t.Amount, cancellationToken);
        return new TaxPosition(Money(collected), Money(paid), Money(collected - paid));
    }

    // ---- The safe's analysis ----

    // Where the safe's money came from and went over a period, as the Safe tab's strip counts it:
    // in, the balance it opened with, the takings (cash, card and the tax on them) and the funding;
    // out, every payment, what the takings paid straight out of them too, each under what it paid
    // for. An entry voided in the period and its void are in neither; an earlier entry's void takes
    // from its own line. Each day of the period with anything in or out, oldest first, with the
    // balance it ended with.
    public async Task<TreasuryAnalytics> GetAnalyticsAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var safe = db.SafeTransactions.AsNoTracking().Where(t => t.Fund == CashFund.Safe);
        var before = await safe.Where(t => t.BusinessDate < from).SumAsync(t => t.Amount, cancellationToken);
        var rows = await safe.Where(t => t.BusinessDate >= from && t.BusinessDate <= to)
            .OrderBy(t => t.BusinessDate).ThenBy(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var ids = rows.Select(t => t.Id).ToHashSet();
        var cancelled = rows.Where(t => t.ReversalOf is { } original && ids.Contains(original))
            .SelectMany(t => new[] { t.Id, t.ReversalOf!.Value })
            .ToHashSet();
        var standing = rows.Where(t => !cancelled.Contains(t.Id)).ToList();

        // What each takings entry had paid straight out of it, by what it paid: the payments out of
        // its day's takings made while they were not in the safe.
        var takings = standing.Where(t => t.Kind == SafeTransactionKind.RevenueTransfer).ToList();
        var days = takings.Select(t => t.RevenueDate!.Value).Distinct().ToList();
        var drawer = (await db.SafeTransactions.AsNoTracking()
                .Where(t => t.Fund == CashFund.DayRevenue && t.RevenueDate != null && days.Contains(t.RevenueDate.Value))
                .ToListAsync(cancellationToken))
            .ToLookup(t => t.RevenueDate!.Value);
        var paidOut = new List<(SafeTransaction Payment, decimal Amount)>();
        foreach (var entry in takings)
        {
            var takenOff = entry.TakingsTotal - entry.Amount;
            var payments = drawer[entry.RevenueDate!.Value].ToList();
            var drawn = -payments.Sum(p => p.Amount);
            if (takenOff == 0 || drawn == 0)
            {
                if (takenOff != 0)
                    paidOut.Add((entry, takenOff));
                continue;
            }
            // Each payment's share of what the entry took off, to the piastre, the last taking the rest.
            var left = takenOff;
            for (var i = 0; i < payments.Count; i++)
            {
                var part = i == payments.Count - 1 ? left : Math.Round(takenOff * -payments[i].Amount / drawn, 2, MidpointRounding.AwayFromZero);
                paidOut.Add((payments[i], part));
                left -= part;
            }
        }

        var outgoing = standing
            .Where(t => t.Kind is not (SafeTransactionKind.RevenueTransfer or SafeTransactionKind.OpeningBalance or SafeTransactionKind.Funding
                or SafeTransactionKind.AssetSale))
            .Select(t => (Payment: t, Amount: -t.Amount))
            .Concat(paidOut)
            .ToList();

        var (cash, card, tax) = (takings.Sum(t => t.GrossAmount ?? t.Amount), takings.Sum(t => t.CardAmount), takings.Sum(t => t.TaxAmount));
        var opening = before + standing.Where(t => t.Kind == SafeTransactionKind.OpeningBalance).Sum(t => t.Amount);
        var funding = standing.Where(t => t.Kind == SafeTransactionKind.Funding).ToList();
        var assetSales = standing.Where(t => t.Kind == SafeTransactionKind.AssetSale).Sum(t => t.Amount);
        var totalIn = cash + card + tax + opening + funding.Sum(t => t.Amount) + assetSales;
        var totalOut = outgoing.Sum(o => o.Amount);

        decimal? Share(decimal part, decimal whole) => whole != 0 ? Math.Round(part * 100 / whole, 1, MidpointRounding.AwayFromZero) : null;
        TreasuryFlowLine Line(string key, string en, string? ar, decimal amount, decimal whole, IReadOnlyList<TreasuryFlowLine>? items = null) =>
            new(key, en, ar, Money(amount), Share(amount, whole), items ?? []);

        var inflows = new List<TreasuryFlowLine>
        {
            Line("cash", "Cash sales", "مبيعات الكاش", cash, totalIn),
            Line("card", "Visa sales", "مبيعات الفيزا", card, totalIn),
            Line("tax", "Tax collected", "الضريبة المحصلة", tax, totalIn),
            Line("opening", "Opening balance", "الرصيد الافتتاحي", opening, totalIn),
            Line("funding", "External funding", "التمويل الخارجي", funding.Sum(t => t.Amount), totalIn,
                funding.GroupBy(t => t.Source)
                    .Select(g => g.Key == FundingSource.OwnerFinancing
                        ? Line("funding-owners", "Owners' financing", "تمويل الشركاء", g.Sum(t => t.Amount), totalIn)
                        : Line("funding-other", "Other source", "مصدر آخر", g.Sum(t => t.Amount), totalIn))
                    .Where(l => l.Amount != 0)
                    .ToList()),
        };
        // Fixed assets sold for cash: investing, never revenue.
        if (assetSales != 0)
            inflows.Add(Line("assetSales", "Fixed assets sold", "بيع أصول ثابتة", assetSales, totalIn));

        // The expense vouchers by their expense's category, as the profit and loss files them.
        var expenseIds = outgoing.Where(o => o.Payment.ExpenseItemId != null).Select(o => o.Payment.ExpenseItemId!.Value).Distinct().ToList();
        var expenseItems = await db.ExpenseItems.AsNoTracking().Where(e => expenseIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id, cancellationToken);
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, cancellationToken);
        decimal Paid(params SafeTransactionKind[] kinds) => outgoing.Where(o => kinds.Contains(o.Payment.Kind)).Sum(o => o.Amount);
        var vouchers = outgoing.Where(o => o.Payment.Kind == SafeTransactionKind.ExpenseVoucher)
            .GroupBy(o => expenseItems.GetValueOrDefault(o.Payment.ExpenseItemId!.Value)?.CategoryId)
            .Select(g =>
            {
                var category = g.Key is { } id ? categories.GetValueOrDefault(id) : null;
                return Line($"expense-{g.Key}", category?.Name ?? "A removed expense", category?.NameAr, g.Sum(o => o.Amount), totalOut);
            })
            .Where(l => l.Amount != 0)
            .OrderByDescending(l => l.Amount)
            .ToList();
        var outflows = new List<TreasuryFlowLine>
        {
            Line("suppliers", "Supplier payments & cash purchases", "مدفوعات الموردين والمشتريات النقدية",
                Paid(SafeTransactionKind.SupplierPayment, SafeTransactionKind.InvoicePayment), totalOut,
                [
                    Line("supplier-payments", "Supplier payments", "سداد موردين", Paid(SafeTransactionKind.SupplierPayment), totalOut),
                    Line("invoice-payments", "Invoices paid in cash", "فواتير نقدية", Paid(SafeTransactionKind.InvoicePayment), totalOut),
                ]),
            Line("expenses", "Operating expense vouchers", "أذون صرف المصروفات", Paid(SafeTransactionKind.ExpenseVoucher), totalOut, vouchers),
            Line("staff", "Staff advances & wages", "سلف وأجور الموظفين",
                Paid(SafeTransactionKind.EmployeeAdvance, SafeTransactionKind.SalaryPayment, SafeTransactionKind.PayrollPayment), totalOut,
                [
                    Line("advances", "Advances", "سلف", Paid(SafeTransactionKind.EmployeeAdvance), totalOut),
                    Line("salaries", "Salaries", "رواتب", Paid(SafeTransactionKind.SalaryPayment, SafeTransactionKind.PayrollPayment), totalOut),
                ]),
            Line("tax", "Tax paid over", "سداد الضرائب", Paid(SafeTransactionKind.TaxPayment), totalOut),
        };
        // Fixed assets bought out of the safe (CAPEX): investing, never an operating expense.
        if (Paid(SafeTransactionKind.AssetPurchase) is not 0 and var capex)
            outflows.Add(Line("capex", "Fixed assets bought (CAPEX)", "شراء أصول ثابتة", capex, totalOut));
        // Takings whose payments out of them are not on record any more: said apart, not lost.
        if (Paid(SafeTransactionKind.RevenueTransfer) is not 0 and var unnamed)
            outflows.Add(Line("takings", "Paid out of the takings", "مصروف من الإيراد", unnamed, totalOut));

        // Day by day: each day's in and out as the strip counts them, and the balance it ended with.
        var balance = before;
        var daily = standing.GroupBy(t => t.BusinessDate).OrderBy(g => g.Key)
            .Select(g =>
            {
                var dayIn = g.Sum(t => t.Kind switch
                {
                    SafeTransactionKind.RevenueTransfer => t.TakingsTotal,
                    SafeTransactionKind.OpeningBalance or SafeTransactionKind.Funding or SafeTransactionKind.AssetSale => t.Amount,
                    _ => 0,
                });
                var dayOut = Out(g);
                balance += dayIn - dayOut;
                var said = g.Where(t => t.Kind == SafeTransactionKind.RevenueTransfer).ToList();
                return new TreasuryDay(
                    g.Key, Money(dayIn), Money(dayOut), Money(dayIn - dayOut), Money(balance), Money(said.Sum(t => t.VoidsAmount)),
                    said.Where(t => !t.IsReversal && t.Notes is not null).Select(t => t.Notes!).ToList());
            })
            .ToList();

        return new TreasuryAnalytics(
            from, to, Money(before), Money(totalIn), Money(totalOut), Money(totalIn - before - totalOut), Money(totalIn - totalOut),
            inflows, outflows, Money(tax), Money(Paid(SafeTransactionKind.TaxPayment)), await GetTaxPositionAsync(to, cancellationToken),
            Money(takings.Sum(t => t.VoidsAmount)), daily);
    }

    // ---- Funding sources ----

    public async Task<FundingReport> GetFundingAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var rows = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Fund == CashFund.Safe && t.BusinessDate >= from && t.BusinessDate <= to
                && (t.Kind == SafeTransactionKind.OpeningBalance || t.Kind == SafeTransactionKind.Funding || t.Kind == SafeTransactionKind.RevenueTransfer))
            .OrderBy(t => t.BusinessDate).ThenBy(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var names = await NamesAsync(rows, cancellationToken);
        decimal Sum(Func<SafeTransaction, bool> which) => Money(rows.Where(which).Sum(t => t.Amount));
        return new FundingReport(
            from, to,
            Sum(t => t.Kind != SafeTransactionKind.RevenueTransfer && t.Source == FundingSource.CarriedOver),
            Sum(t => t.Kind != SafeTransactionKind.RevenueTransfer && t.Source == FundingSource.OwnerFinancing),
            Sum(t => t.Kind != SafeTransactionKind.RevenueTransfer && t.Source == FundingSource.Other),
            Sum(t => t.Kind == SafeTransactionKind.RevenueTransfer),
            Sum(_ => true),
            rows.Select(t => Row(t, names, null)).ToList());
    }

    // ---- Each day's cash ----

    // From the treasury's opening on, once it has one: the cash of the days before it is in the
    // opening balance, not still to be moved in.
    public async Task<DayRevenueReport> GetDayRevenueAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        from = await FromOpeningAsync(from, cancellationToken);
        if (from > to)
            return new DayRevenueReport(from, to, 0, 0, 0, 0, 0, 0, 0, []);
        var sold = (await db.SalesReceipts.AsNoTracking()
                .Where(r => r.VoidedAtUtc == null && r.BusinessDate >= from && r.BusinessDate <= to)
                .Select(r => r.BusinessDate)
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToHashSet();
        var moved = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.RevenueDate != null && t.RevenueDate >= from && t.RevenueDate <= to)
            .ToListAsync(cancellationToken);

        // Voids net out with what they undo, as they share its day.
        var days = sold.Concat(moved.Select(m => m.RevenueDate!.Value)).Distinct().OrderByDescending(d => d)
            .Select(day =>
            {
                var ofDay = moved.Where(m => m.RevenueDate == day).ToList();
                var takings = ofDay.Where(m => m.Kind == SafeTransactionKind.RevenueTransfer).ToList();
                var (cash, card, tax) = (takings.Sum(m => m.GrossAmount ?? m.Amount), takings.Sum(m => m.CardAmount), takings.Sum(m => m.TaxAmount));
                var paid = -ofDay.Where(m => SafeTransaction.PaidOutKinds.Contains(m.Kind)).Sum(m => m.Amount);
                // What of the day's cash is in the safe: the cash less what the drawer had paid by
                // then, less what was paid out of the safe for it since.
                var transferred = ofDay.Where(m => m.Fund == CashFund.Safe).Sum(m => m.Amount);
                return new DayRevenue(
                    day, Money(cash), Money(card), Money(tax), Money(cash + card), Money(takings.Sum(m => m.VoidsAmount)), Money(paid),
                    Money(transferred), takings.Any(m => !m.IsReversal && !m.IsVoided), sold.Contains(day));
            })
            .Where(d => d.Entered || d.HasSales || d.PaidOut != 0)
            .ToList();
        return new DayRevenueReport(
            from, to, Money(days.Sum(d => d.Cash)), Money(days.Sum(d => d.Card)), Money(days.Sum(d => d.Tax)), Money(days.Sum(d => d.NetSales)),
            Money(days.Sum(d => d.Voids)), Money(days.Sum(d => d.PaidOut)), Money(days.Sum(d => d.Transferred)), days);
    }

    // A day's takings before they are entered: the Takings in screen shows what will be taken off.
    public async Task<TakingsPreview> GetTakingsPreviewAsync(DateOnly day, CancellationToken cancellationToken)
    {
        var entries = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.RevenueDate == day && (t.Kind == SafeTransactionKind.RevenueTransfer || t.Fund == CashFund.DayRevenue))
            .ToListAsync(cancellationToken);
        var entered = entries.FirstOrDefault(t => t.Kind == SafeTransactionKind.RevenueTransfer && !t.IsReversal && !t.IsVoided);
        var drawer = entries.Where(t => t.Fund == CashFund.DayRevenue).ToList();
        var standing = drawer.Where(t => !t.IsReversal && !t.IsVoided).ToList();
        return new TakingsPreview(
            day, entered is null ? null : Money(entered.TakingsTotal), Money(-drawer.Sum(t => t.Amount)),
            standing.Count(t => t.Kind == SafeTransactionKind.InvoicePayment), standing.Count(t => t.Kind == SafeTransactionKind.SupplierPayment),
            standing.Count(t => t.Kind is SafeTransactionKind.EmployeeAdvance or SafeTransactionKind.SalaryPayment));
    }

    // Each day of the period whose takings paid an invoice, a supplier or an employee, or were
    // counted into the safe, latest first. A voided entry and its void are both of the entry's day, and come to nothing: neither
    // is listed. Read only: the safe and the takings are as they were.
    public async Task<DailyCashReport> GetDailyCashAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var rows = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.RevenueDate != null && t.RevenueDate >= from && t.RevenueDate <= to
                && (t.Kind == SafeTransactionKind.RevenueTransfer || SafeTransaction.PaidOutKinds.Contains(t.Kind)))
            .OrderBy(t => t.BusinessDate).ThenBy(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var standing = rows.Where(t => !t.IsReversal && !t.IsVoided).ToList();

        var names = await NamesAsync(standing, cancellationToken);
        var invoiceIds = standing.Where(t => t.PurchaseInvoiceId != null).Select(t => t.PurchaseInvoiceId!.Value).Distinct().ToList();
        var invoices = await db.PurchaseInvoices.AsNoTracking().Include(i => i.Lines)
            .Where(i => invoiceIds.Contains(i.Id))
            .ToDictionaryAsync(i => i.Id, cancellationToken);
        var materialIds = invoices.Values.SelectMany(i => i.Lines).Where(l => l.RawMaterialId != null).Select(l => l.RawMaterialId!.Value).Distinct().ToList();
        var materials = await db.RawMaterials.AsNoTracking().Where(m => materialIds.Contains(m.Id))
            .ToDictionaryAsync(m => m.Id, m => m.Name, cancellationToken);

        DailyCashLine Line(SafeTransaction t)
        {
            if (t.Kind == SafeTransactionKind.RevenueTransfer)
                return new DailyCashLine(t.Id, t.Kind, t.BusinessDate, "Takings entered", Money(t.TakingsTotal), null, [], t.RecordedBy, t.ApprovedBy);
            // An employee's advance or salary: who, and the notes as what it was for.
            if (t.Kind is SafeTransactionKind.EmployeeAdvance or SafeTransactionKind.SalaryPayment)
                return new DailyCashLine(
                    t.Id, t.Kind, t.BusinessDate,
                    t.EmployeeId is { } who
                        ? $"{(t.Kind == SafeTransactionKind.EmployeeAdvance ? "Advance to" : "Salary of")} {names.Employees.GetValueOrDefault(who) ?? "a removed employee"}"
                        : "Advances, not given out yet",
                    Money(-t.Amount), null, t.Notes is { } said ? [said] : [], t.RecordedBy, t.ApprovedBy);
            // An old debt paid: the supplier, and the notes (a receipt number) as what it was for.
            if (t.Kind == SafeTransactionKind.SupplierPayment)
                return new DailyCashLine(
                    t.Id, t.Kind, t.BusinessDate, $"Payment to {names.Suppliers.GetValueOrDefault(t.SupplierId!.Value) ?? "a removed supplier"}",
                    Money(-t.Amount), null, t.Notes is { } notes ? [notes] : [], t.RecordedBy, t.ApprovedBy);

            var invoice = t.PurchaseInvoiceId is { } id ? invoices.GetValueOrDefault(id) : null;
            var what = invoice?.SupplierInvoiceNumber is { } number ? $"Invoice {number}"
                : invoice?.InvoiceDate is { } date ? $"Invoice of {date.ToString("d MMM", Invariant)}"
                : "Invoice";
            if ((invoice?.SupplierId ?? t.SupplierId) is { } supplier)
                what += $" · {names.Suppliers.GetValueOrDefault(supplier) ?? "a removed supplier"}";
            var items = invoice is null ? [] : invoice.Lines
                .OrderByDescending(l => l.Cost ?? 0)
                .Select(l => l.RawMaterialId is { } m ? materials.GetValueOrDefault(m) ?? "A removed material"
                    : l.ExpenseItemId is { } e ? names.Expenses.GetValueOrDefault(e) ?? "A removed expense"
                    : "An item")
                .Distinct()
                .ToList();
            return new DailyCashLine(t.Id, t.Kind, t.BusinessDate, what, Money(-t.Amount), t.PurchaseInvoiceId, items, t.RecordedBy, t.ApprovedBy);
        }

        // The sums count every entry, voids too, so a void netting out with what it undid, or
        // putting cash back into the safe, is counted as it moved. The lines are what stands.
        var days = rows.GroupBy(t => t.RevenueDate!.Value).OrderByDescending(g => g.Key)
            .Select(g =>
            {
                var gross = g.Where(t => t.Kind == SafeTransactionKind.RevenueTransfer).Sum(t => t.TakingsTotal);
                var deductions = -g.Where(t => SafeTransaction.PaidOutKinds.Contains(t.Kind)).Sum(t => t.Amount);
                var net = g.Where(t => t.Fund == CashFund.Safe).Sum(t => t.Amount);
                var lines = standing.Where(t => t.RevenueDate == g.Key).ToList();
                return new DailyCashDay(
                    g.Key, Money(gross), Money(deductions), Money(net),
                    lines.Where(t => t.Kind != SafeTransactionKind.RevenueTransfer).Select(Line).ToList(),
                    lines.Where(t => t.Kind == SafeTransactionKind.RevenueTransfer).Select(Line).ToList());
            })
            .Where(d => d.Paid.Count > 0 || d.Entered.Count > 0 || d.Gross != 0 || d.Deductions != 0 || d.NetToSafe != 0)
            .ToList();
        return new DailyCashReport(
            from, to, Money(days.Sum(d => d.Gross)), Money(days.Sum(d => d.Deductions)), Money(days.Sum(d => d.NetToSafe)), days);
    }

    // The first day of a period the treasury has kept: its opening day, when that is later.
    private async Task<DateOnly> FromOpeningAsync(DateOnly from, CancellationToken cancellationToken)
    {
        var opened = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.OpeningBalance && t.ReversalOf == null && t.VoidedAtUtc == null)
            .Select(t => (DateOnly?)t.BusinessDate)
            .FirstOrDefaultAsync(cancellationToken);
        return opened > from ? opened.Value : from;
    }

    // ---- Reconciliation: the cash against the sales ----

    // Each business day from the treasury's opening on, latest first: the takings entered for it
    // against the items sold that day (costing's sales: orders paid at the till by when they were
    // paid, and online orders).
    public async Task<ReconciliationReport> GetReconciliationAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var taxPercent = await TaxPercentAsync(cancellationToken);
        from = await FromOpeningAsync(from, cancellationToken);
        if (from > to)
            return new ReconciliationReport(from, to, taxPercent, Reconcile(null, [], []), []);

        var cash = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.RevenueDate != null && t.RevenueDate >= from && t.RevenueDate <= to
                && t.Kind == SafeTransactionKind.RevenueTransfer)
            .ToListAsync(cancellationToken);
        var (fromUtc, _) = clock.Bounds(from);
        var (_, toUtc) = clock.Bounds(to);
        var sales = (await ledger.GetAsync(fromUtc, toUtc, cancellationToken)).ToLookup(o => clock.BusinessDateOf(o.SoldAtUtc));

        // A day whose only entries were voided, with nothing sold, has nothing to reconcile.
        var days = cash.Select(t => t.RevenueDate!.Value).Concat(sales.Select(g => g.Key)).Distinct().OrderByDescending(d => d)
            .Select(day => Reconcile(day, cash.Where(t => t.RevenueDate == day).ToList(), sales[day].ToList()))
            .Where(d => d.Cash != 0 || d.Card != 0 || sales[d.Date!.Value].Any())
            .ToList();
        var total = new ReconciliationDay(
            null, Money(days.Sum(d => d.Cash)), Money(days.Sum(d => d.Card)), Money(days.Sum(d => d.Tax)), Money(days.Sum(d => d.NetSales)),
            Money(days.Sum(d => d.Voids)), Money(days.Sum(d => d.ItemSales)), Money(days.Sum(d => d.Difference)));
        return new ReconciliationReport(from, to, taxPercent, total, days);
    }

    private static ReconciliationDay Reconcile(DateOnly? day, IReadOnlyList<SafeTransaction> takings, IReadOnlyList<SaleOrder> sales)
    {
        // The takings, a voided entry netting out with its reversal: cash and card, before the tax
        // collected on them.
        var (cash, card, tax) = (takings.Sum(t => t.GrossAmount ?? t.Amount), takings.Sum(t => t.CardAmount), takings.Sum(t => t.TaxAmount));

        // The sales before tax: a day's summary at the menu's prices; a bill entered as printed,
        // what it charged before tax less what was handed back, in the same proportion.
        var items = sales.Sum(sale =>
        {
            var beforeTax = sale.Charged - sale.Tax;
            var refund = sale.Charged > 0 ? Math.Round(sale.Refunded * beforeTax / sale.Charged, 2, MidpointRounding.AwayFromZero) : 0;
            return beforeTax - refund;
        });

        var net = cash + card;
        return new ReconciliationDay(
            day, Money(cash), Money(card), Money(tax), Money(net), Money(takings.Sum(t => t.VoidsAmount)), Money(items), Money(net - items));
    }

    // ---- Tax and service ----

    public async Task<FinancialSettingsDto> GetSettingsAsync(CancellationToken cancellationToken)
    {
        var row = await db.FinancialSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        return new FinancialSettingsDto(await TaxPercentAsync(cancellationToken), row?.ServicePercent ?? 0, row?.UpdatedBy, row?.UpdatedAtUtc);
    }

    public async Task<FinancialSettingsDto> SaveSettingsAsync(SaveFinancialSettingsRequest request, string by, CancellationToken cancellationToken)
    {
        if (request.ServicePercent is < 0 or >= 100)
            throw new DomainException("The service charge is a percentage from 0 up to 100.");
        if (request.TaxPercent is < 0 or >= 100)
            throw new DomainException("The tax is a percentage from 0 up to 100.");
        var row = await db.FinancialSettings.SingleOrDefaultAsync(cancellationToken);
        if (row is null)
            db.FinancialSettings.Add(row = new FinancialSettings());
        row.ServicePercent = Math.Round(request.ServicePercent, 2, MidpointRounding.AwayFromZero);
        if (request.TaxPercent is { } tax)
            row.TaxPercent = Math.Round(tax, 2, MidpointRounding.AwayFromZero);
        row.UpdatedBy = by;
        row.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return await GetSettingsAsync(cancellationToken);
    }

    // The bills' tax rate, as set on Tax & service, or null before it is.
    private async Task<decimal?> TaxPercentAsync(CancellationToken cancellationToken) =>
        (await db.FinancialSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken))?.TaxPercent;

    // ---- Expense vouchers ----

    public async Task<ExpenseVoucherReport> GetExpenseVouchersAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var vouchers = await db.SafeTransactions.AsNoTracking()
            .Where(t => (t.Kind == SafeTransactionKind.ExpenseVoucher || t.Kind == SafeTransactionKind.TaxPayment)
                && t.ReversalOf == null && t.BusinessDate >= from && t.BusinessDate <= to)
            .OrderByDescending(t => t.BusinessDate).ThenByDescending(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var items = await db.ExpenseItems.AsNoTracking().ToDictionaryAsync(e => e.Id, cancellationToken);
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);
        var rows = vouchers.Select(t =>
        {
            if (t.Kind == SafeTransactionKind.TaxPayment)
                return new ExpenseVoucherRow(
                    t.Id, t.BusinessDate, null, "Tax paid over · سداد ضرائب", "Tax · ضرائب", Money(-t.Amount), t.Notes, t.RecordedBy, t.ApprovedBy,
                    t.VoidedAtUtc, t.VoidedBy, IsTaxPayment: true);
            var item = items.GetValueOrDefault(t.ExpenseItemId!.Value);
            return new ExpenseVoucherRow(
                t.Id, t.BusinessDate, t.ExpenseItemId.Value, item?.Name ?? "A removed expense",
                item is null ? null : categories.GetValueOrDefault(item.CategoryId), Money(-t.Amount), t.Notes, t.RecordedBy, t.ApprovedBy,
                t.VoidedAtUtc, t.VoidedBy);
        }).ToList();
        decimal Total(bool tax) => Money(rows.Where(r => r.VoidedAtUtc is null && r.IsTaxPayment == tax).Sum(r => r.Amount));
        return new ExpenseVoucherReport(from, to, Total(false), rows, Total(true));
    }

    // ---- What is owed to suppliers ----

    public async Task<IReadOnlyList<SupplierBalance>> GetSupplierBalancesAsync(CancellationToken cancellationToken)
    {
        var lines = await db.SupplierLedgerEntries.AsNoTracking().ToListAsync(cancellationToken);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, cancellationToken);
        return lines.GroupBy(l => l.SupplierId)
            .Select(g =>
            {
                var supplier = suppliers.GetValueOrDefault(g.Key);
                var (opening, credit, paid) = Totals(g);
                var open = OpenInvoices(g.ToList(), new Dictionary<Guid, PurchaseInvoice>()).Count;
                return new SupplierBalance(
                    g.Key, supplier?.Name ?? "A removed supplier", supplier?.IsArchived ?? false, opening, credit, paid, Money(opening + credit - paid),
                    g.Where(l => l.Kind == SupplierLedgerKind.Payment && !l.IsReversal).Select(l => (DateOnly?)l.BusinessDate).Max(), open);
            })
            .OrderByDescending(b => b.Balance)
            .ThenBy(b => b.Supplier, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public async Task<SupplierStatement?> GetSupplierStatementAsync(Guid supplierId, CancellationToken cancellationToken)
    {
        if (await db.Suppliers.AsNoTracking().SingleOrDefaultAsync(s => s.Id == supplierId, cancellationToken) is not { } supplier)
            return null;
        var lines = await db.SupplierLedgerEntries.AsNoTracking()
            .Where(l => l.SupplierId == supplierId)
            .OrderBy(l => l.BusinessDate).ThenBy(l => l.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var invoiceIds = lines.Where(l => l.Kind == SupplierLedgerKind.CreditInvoice).Select(l => l.SourceId).Distinct().ToList();
        var invoices = await db.PurchaseInvoices.AsNoTracking().Where(i => invoiceIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, cancellationToken);

        var balance = 0m;
        var statement = lines.Select(l =>
        {
            balance += l.Amount;
            return new SupplierStatementLine(
                l.Id, l.BusinessDate, l.Kind, Describe(l, invoices), l.Amount > 0 ? l.Amount : 0, l.Amount < 0 ? -l.Amount : 0, Money(balance), l.SourceId,
                l.IsReversal);
        }).ToList();
        var (opening, credit, paid) = Totals(lines);
        return new SupplierStatement(supplierId, supplier.Name, opening, credit, paid, Money(opening + credit - paid), statement, OpenInvoices(lines, invoices));
    }

    // The advances paid in a period, latest first, voided ones too (marked).
    public async Task<IReadOnlyList<AdvanceRow>> GetAdvancesAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var advances = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.EmployeeAdvance && t.ReversalOf == null && t.BusinessDate >= from && t.BusinessDate <= to)
            .OrderByDescending(t => t.BusinessDate).ThenByDescending(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var names = await db.Staff.AsNoTracking().ToDictionaryAsync(e => e.Id, e => e.Name, cancellationToken);
        return advances
            .Select(t => new AdvanceRow(
                t.Id, t.BusinessDate, t.EmployeeId,
                t.EmployeeId is { } id ? names.GetValueOrDefault(id) ?? "A removed employee" : "Not given out yet", Money(-t.Amount),
                t.PayrollMonth, t.RevenueDate, t.Notes, t.RecordedBy, t.ApprovedBy, t.VoidedAtUtc, t.VoidedBy))
            .ToList();
    }

    public async Task<IReadOnlyList<SupplierPaymentRow>> GetSupplierPaymentsAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var payments = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.SupplierPayment && t.ReversalOf == null && t.BusinessDate >= from && t.BusinessDate <= to)
            .OrderByDescending(t => t.BusinessDate).ThenByDescending(t => t.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var names = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);
        return payments
            .Select(t => new SupplierPaymentRow(
                t.Id, t.BusinessDate, t.SupplierId!.Value, names.GetValueOrDefault(t.SupplierId.Value) ?? "A removed supplier", Money(-t.Amount), t.Notes,
                t.RecordedBy, t.ApprovedBy, t.VoidedAtUtc, t.VoidedBy, t.RevenueDate))
            .ToList();
    }

    // Opening debt, credit purchases and payments, each net of what was undone.
    internal static (decimal Opening, decimal Credit, decimal Paid) Totals(IEnumerable<SupplierLedgerEntry> lines)
    {
        var all = lines.ToList();
        return (
            Money(all.Where(l => l.Kind == SupplierLedgerKind.OpeningBalance).Sum(l => l.Amount)),
            Money(all.Where(l => l.Kind == SupplierLedgerKind.CreditInvoice).Sum(l => l.Amount)),
            Money(-all.Where(l => l.Kind == SupplierLedgerKind.Payment).Sum(l => l.Amount)));
    }

    // The credit invoices still owed, oldest first: what was paid is set against the opening debt,
    // then against each invoice in turn.
    internal static IReadOnlyList<OpenInvoice> OpenInvoices(IReadOnlyList<SupplierLedgerEntry> lines, IReadOnlyDictionary<Guid, PurchaseInvoice> invoices)
    {
        var (opening, _, paid) = Totals(lines);
        var left = Math.Max(paid - opening, 0);
        var standing = lines
            .Where(l => l.Kind == SupplierLedgerKind.CreditInvoice)
            .GroupBy(l => l.SourceId)
            .Select(g => (Id: g.Key, Date: g.Where(l => !l.IsReversal).Select(l => l.BusinessDate).DefaultIfEmpty(g.First().BusinessDate).Min(),
                Total: g.Sum(l => l.Amount)))
            .Where(i => i.Total > 0)
            .OrderBy(i => i.Date)
            .ToList();
        var open = new List<OpenInvoice>();
        foreach (var (id, date, total) in standing)
        {
            var applied = Math.Min(left, total);
            left -= applied;
            if (applied < total)
                open.Add(new OpenInvoice(
                    id, invoices.GetValueOrDefault(id)?.SupplierInvoiceNumber, date, Money(total), Money(applied), Money(total - applied),
                    applied > 0 ? OpenInvoiceStatus.PartlyPaid : OpenInvoiceStatus.Unpaid));
        }

        return open;
    }

    private static string Describe(SupplierLedgerEntry line, IReadOnlyDictionary<Guid, PurchaseInvoice> invoices)
    {
        var what = line.Kind switch
        {
            SupplierLedgerKind.OpeningBalance => "Owed before the treasury",
            SupplierLedgerKind.CreditInvoice => invoices.GetValueOrDefault(line.SourceId)?.SupplierInvoiceNumber is { } number
                ? $"Invoice {number} on credit"
                : "Invoice on credit",
            _ => "Payment voucher",
        };
        return line.IsReversal ? $"Voided: {what}" : what;
    }

    // ---- Shared ----

    private sealed record Names(
        IReadOnlyDictionary<Guid, string> Suppliers, IReadOnlyDictionary<Guid, string> Expenses, IReadOnlyDictionary<Guid, string?> Invoices,
        IReadOnlyDictionary<Guid, string> Employees, IReadOnlyDictionary<Guid, string> Assets);

    private async Task<Names> NamesAsync(IReadOnlyList<SafeTransaction> rows, CancellationToken cancellationToken)
    {
        var invoiceIds = rows.Where(t => t.PurchaseInvoiceId != null).Select(t => t.PurchaseInvoiceId!.Value).Distinct().ToList();
        return new Names(
            await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken),
            await db.ExpenseItems.AsNoTracking().ToDictionaryAsync(e => e.Id, e => e.Name, cancellationToken),
            await db.PurchaseInvoices.AsNoTracking().Where(i => invoiceIds.Contains(i.Id))
                .ToDictionaryAsync(i => i.Id, i => i.SupplierInvoiceNumber, cancellationToken),
            await db.Staff.AsNoTracking().ToDictionaryAsync(e => e.Id, e => e.Name, cancellationToken),
            await AssetNamesAsync(rows.Where(t => t.FixedAssetId != null).Select(t => t.FixedAssetId!.Value).Distinct().ToList(), cancellationToken));
    }

    private async Task<IReadOnlyDictionary<Guid, string>> AssetNamesAsync(List<Guid> ids, CancellationToken cancellationToken) =>
        ids.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.FixedAssets.AsNoTracking().Where(a => ids.Contains(a.Id)).ToDictionaryAsync(a => a.Id, a => a.AssetCode + " " + a.Name, cancellationToken);

    private static SafeEntryRow Row(SafeTransaction t, Names names, decimal? balance)
    {
        string Asset() => t.FixedAssetId is { } id ? names.Assets.GetValueOrDefault(id) ?? "a removed asset" : "an asset";
        string Supplier() => t.SupplierId is { } id ? names.Suppliers.GetValueOrDefault(id) ?? "a removed supplier" : "no supplier";
        string Takings() => t.RevenueDate is { } day ? $" · from the takings of {day.ToString("d MMM", Invariant)}" : "";
        string Employee() => t.EmployeeId is { } id ? names.Employees.GetValueOrDefault(id) ?? "a removed employee" : "an employee";
        var what = t.Kind switch
        {
            SafeTransactionKind.OpeningBalance => $"Opening balance · {SourceName(t.Source)}",
            SafeTransactionKind.Funding => $"Funding · {SourceName(t.Source)}",
            SafeTransactionKind.RevenueTransfer => $"Takings of {t.RevenueDate!.Value.ToString("d MMM", Invariant)}" +
                (t.TakingsTotal - t.Amount != 0 ? $" · {Pounds(Math.Abs(t.TakingsTotal))} collected, less {Pounds(Math.Abs(t.TakingsTotal - t.Amount))} paid out of it" : ""),
            SafeTransactionKind.ExpenseVoucher => t.ExpenseItemId is { } e ? names.Expenses.GetValueOrDefault(e) ?? "A removed expense" : "An expense",
            SafeTransactionKind.TaxPayment => "Tax paid over · سداد ضرائب",
            SafeTransactionKind.SupplierPayment => $"Payment to {Supplier()}" +
                (t.RevenueDate is { } paidFrom ? $" · from the takings of {paidFrom.ToString("d MMM", Invariant)}" : ""),
            SafeTransactionKind.EmployeeAdvance when t.EmployeeId is null => "Advances, not given out yet" + Takings(),
            SafeTransactionKind.EmployeeAdvance => $"Advance to {Employee()}" + Takings(),
            SafeTransactionKind.SalaryPayment => $"Salary of {Employee()}" + (t.PayrollMonth is { } month ? $" · {month.ToString("MMMM yyyy", Invariant)}" : "") + Takings(),
            SafeTransactionKind.PayrollPayment => "Payroll from HR" + (t.PayrollMonth is { } run ? $" · {run.ToString("MMMM yyyy", Invariant)}" : ""),
            SafeTransactionKind.AssetPurchase => $"Fixed asset bought (CAPEX) · {Asset()}" + (t.Fund == CashFund.Bank ? " · by the bank" : ""),
            SafeTransactionKind.AssetSale => $"Fixed asset sold · {Asset()}" + (t.Fund == CashFund.Bank ? " · into the bank" : ""),
            _ => (t.PurchaseInvoiceId is { } i && names.Invoices.GetValueOrDefault(i) is { } number ? $"Invoice {number}" : "Invoice") +
                 (t.SupplierId is null ? "" : $" · {Supplier()}") +
                 (t.RevenueDate is { } day ? $" · from the takings of {day.ToString("d MMM", Invariant)}" : ""),
        };
        return new SafeEntryRow(
            t.Id, t.Kind, t.Fund, t.BusinessDate, t.IsReversal ? $"Voided: {what}" : what, t.Amount > 0 ? t.Amount : 0, t.Amount < 0 ? -t.Amount : 0,
            balance is { } b ? Money(b) : null, t.Source, t.RevenueDate, t.SupplierId, t.PurchaseInvoiceId, t.ExpenseItemId, t.Notes, t.RecordedBy,
            t.RecordedAtUtc, t.ApprovedBy, t.ReversalOf, t.VoidedAtUtc, t.VoidedBy, t.IncludesTax, t.TaxPercent, t.TaxAmount, t.GrossAmount,
            t.CardAmount, t.VoidsAmount);
    }

    private static string Pounds(decimal value) => Costing.Application.Common.CompanyMoney.Text(value);

    private static string SourceName(FundingSource? source) => source switch
    {
        FundingSource.CarriedOver => "carried over",
        FundingSource.OwnerFinancing => "owners' financing",
        _ => "other source",
    };

    private static void Period(DateOnly from, DateOnly to)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last.");
        if (to > from.AddYears(2))
            throw new DomainException("Choose two years at most.");
    }
}
```


### 1.6 الأصول الثابتة والإهلاك: CAPEX ليس OPEX

المصروف التشغيلي (إيجار، غاز، صيانة) يُستهلك في شهره ويدخل قائمة دخله كاملًا. أما الأصل الثابت (ماكينة إسبريسو، فرن، أثاث، نقاط بيع، ديكورات) فيخدم سنوات: **ثمنه يخرج من الخزنة أو البنك يوم الشراء، لكن قائمة الدخل لا ترى الشراء أبدًا**، بل ترى إهلاكه شهرًا بشهر. لذلك نوعان جديدان في دفتر الخزنة: `AssetPurchase` (سالب، من `CashFund.Safe` أو `CashFund.Bank`) و `AssetSale` (موجب)، ويمران بنفس `TreasuryWriter`: المدير فورًا وغيره طلب موافقة، والإلغاء بقيد عكسي. والبنك صندوق لا يحسبه رصيد الخزنة ولا تقاريرها (كلها تفلتر `Fund == Safe`)، فيبقى `SafeBalanceAsync` كما هو.

```text
القسط الشهري       = (تكلفة الشراء − القيمة التخريدية) ÷ العمر الإنتاجي بالأشهر، مقربًا لقرشين
الأشهر المحملة حتى M = من شهر الشراء (يُحسب كاملًا) حتى M، بدون شهر الاستبعاد وما بعده، بحد أقصى العمر
مجمع الإهلاك        = القسط × الأشهر المحملة (وكامل التكلفة − التخريدية عند انتهاء العمر: الشهر الأخير يأخذ فرق التقريب)
القيمة الدفترية      = التكلفة − مجمع الإهلاك
إهلاك الشهر M        = المجمع حتى نهاية M − المجمع حتى نهاية الشهر السابق
ربح/خسارة الاستبعاد = قيمة البيع (صفر للاستبعاد) − القيمة الدفترية قبل شهر الاستبعاد
```

لماذا يُحسب كل شيء من الشهر لا من حالة الأصل الحالية؟ لأن بيع أصل في يناير يجب ألا يغيّر إهلاك ديسمبر المقفل: `DepreciationFor(month)` يقرأ تاريخ الأصل كله. والأصل `FixedAsset` لا يُحذف، يُعلَّم (`VoidedAtUtc`) مع إلغاء قيد شرائه. ولا مفتاح أجنبي من `SafeTransactions.FixedAssetId` للأصل: الأصل يشير لقيديه، والاثنان يُحفظان معًا، والمفتاح في الاتجاهين دائرة لا يحفظها EF.

> 📄 **`backend/src/Costing.Domain/FixedAssets/FixedAsset.cs`** — 337 سطر

```csharp
using Costing.Domain.Common;
using Costing.Domain.Treasury;

namespace Costing.Domain.FixedAssets;

// What kind of asset it is, as the register groups it.
public enum FixedAssetCategory
{
    // Ovens, fryers, espresso machines, fridges (معدات المطبخ).
    KitchenEquipment = 1,

    // Tables, chairs, counters (الأثاث).
    Furniture = 2,

    Vehicles = 3,

    // Computers, the POS terminals, printers, screens (أجهزة الحاسب ونقاط البيع).
    ItAndPos = 4,

    // The place's fit-out: decoration, flooring, ducts (تجهيزات وديكورات المكان).
    FitOut = 5,

    Other = 6,
}

// Where an asset stands. Active and FullyDepreciated are worked out from its age as of a month
// (StatusAsOf); Disposed and Sold are what was done with it. Kept: Active, Disposed or Sold.
public enum FixedAssetStatus
{
    Active = 1,

    // Still in use, its whole cost less its salvage value depreciated: nothing more to charge.
    FullyDepreciated = 2,

    // Thrown away, scrapped or given away (استبعاد): what was left of its cost written off as a loss.
    Disposed = 3,

    // Sold (بيع): what it brought in, into the safe or the bank, set against what was left of its cost.
    Sold = 4,
}

// A fixed asset (أصل ثابت): equipment, furniture, a vehicle, the POS, the place's fit-out. Capital
// spending (CAPEX), not an expense: what it cost leaves the safe or the bank the day it is bought,
// but the profit and loss takes it a month at a time over its useful life, straight-line:
//
//   Monthly depreciation     = (purchase cost − salvage value) ÷ useful life in months
//   Accumulated depreciation = monthly depreciation × the months charged, at most the useful life
//   Net book value           = purchase cost − accumulated depreciation
//
// A month is charged in full: the month it was bought is the first, the month it is disposed of or
// sold is not charged. The last month of its life takes what the rounding left, so the depreciation
// adds up to the cost less the salvage value exactly. Disposed of or sold, the net book value then
// left is set against what it brought in: the gain or loss is the disposal month's.
//
// Paid (PaidFrom), it is bought by a safe entry (AssetPurchase, PurchaseTransactionId) out of the
// safe or the bank; owned already when the register started, by none. Removed from the register,
// it is only marked so (VoidedAtUtc), its payment voided with it.
public sealed class FixedAsset : AggregateRoot
{
    public const int MaxNameLength = 120;
    public const int MaxLocationLength = 80;
    public const int MaxNotesLength = 500;
    public const int MaxUsefulLifeMonths = 600;

    private FixedAsset() { }

    public FixedAsset(
        Guid id, int number, string name, FixedAssetCategory category, string? location, string? notes, DateOnly purchaseDate, decimal purchaseCost,
        decimal salvageValue, int usefulLifeMonths, CashFund? paidFrom, Guid? purchaseTransactionId, string by)
    {
        if (number <= 0)
            throw new DomainException("An asset's number is 1 or more.");
        if (paidFrom is not (null or CashFund.Safe or CashFund.Bank))
            throw new DomainException("An asset is paid from the safe or the bank. · يدفع الأصل من الخزنة أو البنك.");
        if ((paidFrom is null) != (purchaseTransactionId is null))
            throw new DomainException("A paid asset names the entry that paid it.");
        Id = id;
        Number = number;
        AssetCode = CodeOf(number);
        PaidFrom = paidFrom;
        PurchaseTransactionId = purchaseTransactionId;
        CreatedAtUtc = DateTime.UtcNow;
        CreatedBy = by;
        SetCost(purchaseDate, purchaseCost);
        Change(name, category, location, notes, salvageValue, usefulLifeMonths, by);
        UpdatedAtUtc = null;
        UpdatedBy = null;
    }

    // FA-0001, FA-0002: by the order they were entered.
    public int Number { get; private set; }
    public string AssetCode { get; private set; } = string.Empty;

    public string Name { get; private set; } = string.Empty;
    public FixedAssetCategory Category { get; private set; }

    // Where it is: the kitchen, the bar, the dining room, a branch.
    public string? Location { get; private set; }
    public string? Notes { get; private set; }

    public DateOnly PurchaseDate { get; private set; }

    // What it cost to buy and put in place, all of it (تكلفة الشراء).
    public decimal PurchaseCost { get; private set; }

    // What it should still be worth at the end of its life (القيمة التخريدية): never depreciated.
    public decimal SalvageValue { get; private set; }

    // How many months it is expected to serve (العمر الإنتاجي): 60 for five years.
    public int UsefulLifeMonths { get; private set; }

    // Active, Disposed or Sold: what was done with it. As of a month, see StatusAsOf.
    public FixedAssetStatus Status { get; private set; } = FixedAssetStatus.Active;

    // Paid out of the safe or the bank, by that entry; neither for an asset owned already.
    public CashFund? PaidFrom { get; private set; }
    public Guid? PurchaseTransactionId { get; private set; }

    // Disposed of or sold: when, what it brought in and where that went (the safe or the bank, by
    // that entry), why, and who did it.
    public DateOnly? DisposalDate { get; private set; }
    public decimal? SaleProceeds { get; private set; }
    public CashFund? SaleFund { get; private set; }
    public Guid? SaleTransactionId { get; private set; }
    public string? DisposalNotes { get; private set; }
    public string? DisposedBy { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public string CreatedBy { get; private set; } = string.Empty;
    public DateTime? UpdatedAtUtc { get; private set; }
    public string? UpdatedBy { get; private set; }

    // Off the register: entered by mistake, or its purchase voided.
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsVoided => VoidedAtUtc is not null;

    public bool IsOwnedAlready => PaidFrom is null;
    public bool IsGone => Status is FixedAssetStatus.Disposed or FixedAssetStatus.Sold;

    public static string CodeOf(int number) => $"FA-{number:0000}";

    // ---- Depreciation ----

    public decimal DepreciableAmount => PurchaseCost - SalvageValue;

    // (purchase cost − salvage value) ÷ useful life, to the piastre.
    public decimal MonthlyDepreciation => Round(DepreciableAmount / UsefulLifeMonths);

    public DateOnly FirstMonth => MonthOf(PurchaseDate);

    // The months charged up to and including `month` (any day of it): from the month it was bought,
    // never the month it was disposed of or after, never more than its useful life.
    public int MonthsChargedThrough(DateOnly month)
    {
        if (IsVoided)
            return 0;
        var through = MonthsBetween(FirstMonth, MonthOf(month)) + 1;
        if (IsGone && DisposalDate is { } gone)
            through = Math.Min(through, MonthsBetween(FirstMonth, MonthOf(gone)));
        return Math.Clamp(through, 0, UsefulLifeMonths);
    }

    // Depreciated by the end of `month`: the months charged at the monthly rate, the whole
    // depreciable amount once its life is through.
    public decimal AccumulatedThrough(DateOnly month) => Accumulated(MonthsChargedThrough(month));

    // What `month`'s profit and loss is charged for it.
    public decimal DepreciationFor(DateOnly month) => AccumulatedThrough(month) - AccumulatedThrough(MonthOf(month).AddMonths(-1));

    // Its cost less what is depreciated by the end of `month`.
    public decimal NetBookValueThrough(DateOnly month) => PurchaseCost - AccumulatedThrough(month);

    // Disposed of or sold: its cost less what was depreciated by then, and what it brought in less that.
    public decimal? NetBookValueAtDisposal => IsGone ? PurchaseCost - Accumulated(MonthsChargedThrough(DisposalDate!.Value)) : null;
    public decimal? GainOrLoss => NetBookValueAtDisposal is { } left ? (SaleProceeds ?? 0) - left : null;

    // As it stood at the end of `month`: gone once it was disposed of or sold in or before it;
    // fully depreciated once its life is charged; otherwise active.
    public FixedAssetStatus StatusAsOf(DateOnly month)
    {
        if (IsGone && DisposalDate is { } gone && MonthOf(gone) <= MonthOf(month))
            return Status;
        return MonthsChargedThrough(month) >= UsefulLifeMonths ? FixedAssetStatus.FullyDepreciated : FixedAssetStatus.Active;
    }

    private decimal Accumulated(int months) =>
        months >= UsefulLifeMonths ? DepreciableAmount : Math.Min(DepreciableAmount, MonthlyDepreciation * months);

    // ---- Changes ----

    // Its details and what its depreciation is worked out from. A change to the life or the salvage
    // value restates every month's depreciation, past ones too: a correction.
    public void Change(string name, FixedAssetCategory category, string? location, string? notes, decimal salvageValue, int usefulLifeMonths, string by)
    {
        EnsureOnRegister();
        if (IsGone)
            throw new DomainException("This asset is disposed of: undo that first to change it. · الأصل مستبعد.");
        var trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length == 0)
            throw new DomainException("Name the asset. · اكتب اسم الأصل.");
        if (trimmed.Length > MaxNameLength)
            throw new DomainException($"Keep the name under {MaxNameLength} characters.");
        if (!Enum.IsDefined(category))
            throw new DomainException("Choose the asset's category. · اختر فئة الأصل.");
        if (location?.Trim().Length > MaxLocationLength)
            throw new DomainException($"Keep the location under {MaxLocationLength} characters.");
        if (notes?.Trim().Length > MaxNotesLength)
            throw new DomainException($"Keep the notes under {MaxNotesLength} characters.");
        if (usefulLifeMonths is < 1 or > MaxUsefulLifeMonths)
            throw new DomainException($"The useful life is 1 to {MaxUsefulLifeMonths} months. · العمر الإنتاجي من 1 إلى {MaxUsefulLifeMonths} شهرًا.");
        var salvage = Round(salvageValue);
        if (salvage < 0)
            throw new DomainException("The salvage value is zero or more. · القيمة التخريدية صفر أو أكثر.");
        if (salvage >= PurchaseCost)
            throw new DomainException("The salvage value is less than what the asset cost. · القيمة التخريدية أقل من التكلفة.");

        Name = trimmed;
        Category = category;
        Location = string.IsNullOrWhiteSpace(location) ? null : location.Trim();
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        SalvageValue = salvage;
        UsefulLifeMonths = usefulLifeMonths;
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    // An asset owned already: when it was bought and what it cost, corrected, with the salvage value
    // it is to keep. A paid one's are its payment's: void the purchase and enter it again.
    public void Recost(DateOnly purchaseDate, decimal purchaseCost, decimal salvageValue, string by)
    {
        EnsureOnRegister();
        if (!IsOwnedAlready)
            throw new DomainException("What a paid asset cost is its payment's: void the purchase and enter it again. · ألغِ الشراء وأدخله من جديد.");
        if (IsGone)
            throw new DomainException("This asset is disposed of: undo that first to change it. · الأصل مستبعد.");
        if (Round(salvageValue) >= Round(purchaseCost))
            throw new DomainException("The salvage value is less than what the asset cost. · القيمة التخريدية أقل من التكلفة.");
        SetCost(purchaseDate, purchaseCost);
        SalvageValue = Math.Max(Round(salvageValue), 0);
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    // Disposed of with nothing for it (استبعاد): what was left of its cost is the month's loss.
    public void WriteOff(DateOnly date, string? notes, string by) => Dispose(date, null, null, null, notes, by);

    // Sold (بيع): what it brought in went into the safe or the bank by that entry.
    public void Sell(DateOnly date, decimal proceeds, CashFund fund, Guid saleTransactionId, string? notes, string by)
    {
        if (proceeds <= 0)
            throw new DomainException("Enter what the asset was sold for, more than nothing. · أدخل قيمة البيع.");
        if (fund is not (CashFund.Safe or CashFund.Bank))
            throw new DomainException("A sale is paid into the safe or the bank. · تورد قيمة البيع للخزنة أو البنك.");
        Dispose(date, Round(proceeds), fund, saleTransactionId, notes, by);
    }

    // Back in use: a write-off undone, or a sale whose entry was voided. Depreciated again from where it stopped.
    public void Reinstate(string by)
    {
        EnsureOnRegister();
        if (!IsGone)
            throw new DomainException("This asset is in use already.");
        Status = FixedAssetStatus.Active;
        DisposalDate = null;
        SaleProceeds = null;
        SaleFund = null;
        SaleTransactionId = null;
        DisposalNotes = null;
        DisposedBy = null;
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    // Off the register. A sold or disposed one is brought back first: its sale undone.
    public void Void(string by)
    {
        EnsureOnRegister();
        if (Status == FixedAssetStatus.Sold)
            throw new DomainException("This asset is sold: void its sale first. · ألغِ بيع الأصل أولًا.");
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = by;
    }

    private void Dispose(DateOnly date, decimal? proceeds, CashFund? fund, Guid? saleTransactionId, string? notes, string by)
    {
        EnsureOnRegister();
        if (IsGone)
            throw new DomainException("This asset is disposed of already. · الأصل مستبعد بالفعل.");
        if (date < PurchaseDate)
            throw new DomainException("An asset is disposed of on the day it was bought or after. · تاريخ الاستبعاد بعد تاريخ الشراء.");
        if (notes?.Trim().Length > MaxNotesLength)
            throw new DomainException($"Keep the notes under {MaxNotesLength} characters.");
        Status = proceeds is null ? FixedAssetStatus.Disposed : FixedAssetStatus.Sold;
        DisposalDate = date;
        SaleProceeds = proceeds;
        SaleFund = fund;
        SaleTransactionId = saleTransactionId;
        DisposalNotes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        DisposedBy = by;
        UpdatedAtUtc = DateTime.UtcNow;
        UpdatedBy = by;
    }

    private void SetCost(DateOnly purchaseDate, decimal purchaseCost)
    {
        var cost = Round(purchaseCost);
        if (cost <= 0)
            throw new DomainException("Enter what the asset cost, more than nothing. · أدخل تكلفة الأصل.");
        PurchaseDate = purchaseDate;
        PurchaseCost = cost;
    }

    private void EnsureOnRegister()
    {
        if (IsVoided)
            throw new DomainException("This asset is off the register. · الأصل محذوف من السجل.");
    }

    public static DateOnly MonthOf(DateOnly day) => new(day.Year, day.Month, 1);

    private static int MonthsBetween(DateOnly from, DateOnly to) => (to.Year - from.Year) * 12 + to.Month - from.Month;

    private static decimal Round(decimal amount) => Math.Round(amount, 2, MidpointRounding.AwayFromZero);
}

public interface IFixedAssetRepository : IRepository<FixedAsset>
{
    // Every asset on the register, voided ones left out.
    Task<IReadOnlyList<FixedAsset>> GetAllAsync(CancellationToken cancellationToken = default);

    // The asset a safe entry bought or sold, if any.
    Task<FixedAsset?> GetByTransactionAsync(Guid transactionId, CancellationToken cancellationToken = default);

    // The next asset's number: one more than the highest so far, voided ones counted.
    Task<int> NextNumberAsync(CancellationToken cancellationToken = default);
}
```


ما لا يحرك نقدًا للمدير وحده: أصل قائم قبل السجل، تعديل البيانات (تكلفة وتاريخ الأصل المدفوع لقيد شرائه)، الاستبعاد بلا مقابل والتراجع عنه، وحذف الأصل القائم.

> 📄 **`backend/src/Costing.Application/FixedAssets/FixedAssets.cs`** — 140 سطر

```csharp
using MediatR;
using Costing.Application.Common;
using Costing.Application.Treasury;
using Costing.Domain.Common;
using Costing.Domain.FixedAssets;

namespace Costing.Application.FixedAssets;

// The fixed assets register (سجل الأصول الثابتة): what moves no cash, a manager's. An asset bought,
// or sold for money, is a safe entry (SafeVoucher, AssetPurchase and AssetSale) and goes through
// the treasury: entered at once for a manager, asked of one for anyone else, voided as any entry is.
// Here: an asset owned already when the register started, its details changed, one disposed of with
// nothing for it, that undone, and one owned already taken off the register.

public sealed record FixedAssetSaved(Guid Id, string AssetCode);

// Owned already: on the register at what it cost and when, paid before it and through no entry here.
// AssetId is made by the till: a retry finds the asset made.
public sealed record RegisterOwnedAssetCommand(Guid AssetId, FixedAssetInput Asset, DateOnly PurchaseDate, decimal PurchaseCost, string By)
    : IRequest<FixedAssetSaved>, IRetryOnConflict;

// What it is and what its depreciation is worked out from; for one owned already, its cost and the
// day it was bought too (a paid one's are its payment's).
public sealed record ChangeFixedAssetCommand(Guid AssetId, FixedAssetInput Asset, DateOnly? PurchaseDate, decimal? PurchaseCost, string By)
    : IRequest<FixedAssetSaved>, IRetryOnConflict;

// Disposed of with nothing for it (استبعاد): its depreciation stops, what was left of its cost is the
// month's loss. Sold for money is a safe entry instead.
public sealed record WriteOffFixedAssetCommand(Guid AssetId, DateOnly Date, string? Notes, string By) : IRequest<FixedAssetSaved>, IRetryOnConflict;

// A write-off undone: in use again, depreciated from where it stopped.
public sealed record ReinstateFixedAssetCommand(Guid AssetId, string By) : IRequest<FixedAssetSaved>, IRetryOnConflict;

// One owned already, off the register (entered by mistake). A paid one goes with its purchase voided.
public sealed record RemoveFixedAssetCommand(Guid AssetId, string By) : IRequest, IRetryOnConflict;

internal sealed class RegisterOwnedAssetHandler(IFixedAssetRepository assets, TreasuryWriter treasury, IUnitOfWork unitOfWork)
    : IRequestHandler<RegisterOwnedAssetCommand, FixedAssetSaved>
{
    public async Task<FixedAssetSaved> Handle(RegisterOwnedAssetCommand request, CancellationToken cancellationToken)
    {
        if (await assets.GetByIdAsync(request.AssetId, cancellationToken) is { } made)
            return new FixedAssetSaved(made.Id, made.AssetCode);
        if (request.PurchaseDate > treasury.Latest)
            throw new DomainException("An asset owned already was bought today or before. · تاريخ الشراء اليوم أو قبله.");
        var a = request.Asset ?? throw new DomainException("Say what the asset is. · أدخل بيانات الأصل.");
        var asset = new FixedAsset(
            request.AssetId, await assets.NextNumberAsync(cancellationToken), a.Name, a.Category, a.Location, a.Notes, request.PurchaseDate,
            request.PurchaseCost, a.SalvageValue, a.UsefulLifeMonths, null, null, request.By);
        assets.Add(asset);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new FixedAssetSaved(asset.Id, asset.AssetCode);
    }
}

internal sealed class ChangeFixedAssetHandler(IFixedAssetRepository assets, TreasuryWriter treasury, IUnitOfWork unitOfWork)
    : IRequestHandler<ChangeFixedAssetCommand, FixedAssetSaved>
{
    public async Task<FixedAssetSaved> Handle(ChangeFixedAssetCommand request, CancellationToken cancellationToken)
    {
        var asset = await FixedAssetRules.GetAsync(assets, request.AssetId, cancellationToken);
        var a = request.Asset ?? throw new DomainException("Say what the asset is. · أدخل بيانات الأصل.");
        var (date, cost) = (request.PurchaseDate ?? asset.PurchaseDate, request.PurchaseCost ?? asset.PurchaseCost);
        if (date != asset.PurchaseDate || cost != asset.PurchaseCost)
        {
            if (date > treasury.Latest)
                throw new DomainException("An asset owned already was bought today or before. · تاريخ الشراء اليوم أو قبله.");
            asset.Recost(date, cost, a.SalvageValue, request.By);
        }
        asset.Change(a.Name, a.Category, a.Location, a.Notes, a.SalvageValue, a.UsefulLifeMonths, request.By);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new FixedAssetSaved(asset.Id, asset.AssetCode);
    }
}

internal sealed class WriteOffFixedAssetHandler(IFixedAssetRepository assets, TreasuryWriter treasury, IUnitOfWork unitOfWork)
    : IRequestHandler<WriteOffFixedAssetCommand, FixedAssetSaved>
{
    public async Task<FixedAssetSaved> Handle(WriteOffFixedAssetCommand request, CancellationToken cancellationToken)
    {
        var asset = await FixedAssetRules.GetAsync(assets, request.AssetId, cancellationToken);
        // Retried after it was saved: done already.
        if (asset.Status == FixedAssetStatus.Disposed && asset.DisposalDate == request.Date)
            return new FixedAssetSaved(asset.Id, asset.AssetCode);
        if (request.Date > treasury.Latest)
            throw new DomainException("An asset is disposed of today or before. · تاريخ الاستبعاد اليوم أو قبله.");
        asset.WriteOff(request.Date, request.Notes, request.By);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return new FixedAssetSaved(asset.Id, asset.AssetCode);
    }
}

internal sealed class ReinstateFixedAssetHandler(IFixedAssetRepository assets, IUnitOfWork unitOfWork)
    : IRequestHandler<ReinstateFixedAssetCommand, FixedAssetSaved>
{
    public async Task<FixedAssetSaved> Handle(ReinstateFixedAssetCommand request, CancellationToken cancellationToken)
    {
        var asset = await FixedAssetRules.GetAsync(assets, request.AssetId, cancellationToken);
        if (asset.Status == FixedAssetStatus.Sold)
            throw new DomainException("A sale is undone by voiding its entry: what it brought in goes back out. · ألغِ قيد البيع.");
        if (asset.IsGone)
        {
            asset.Reinstate(request.By);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }
        return new FixedAssetSaved(asset.Id, asset.AssetCode);
    }
}

internal sealed class RemoveFixedAssetHandler(IFixedAssetRepository assets, IUnitOfWork unitOfWork) : IRequestHandler<RemoveFixedAssetCommand>
{
    public async Task Handle(RemoveFixedAssetCommand request, CancellationToken cancellationToken)
    {
        var asset = await assets.GetByIdAsync(request.AssetId, cancellationToken) ?? throw new NotFoundException("Fixed asset", request.AssetId);
        if (asset.IsVoided)
            return;
        if (!asset.IsOwnedAlready)
            throw new DomainException("A paid asset leaves the register with its purchase voided: what it cost goes back. · ألغِ قيد الشراء.");
        asset.Void(request.By);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }
}

internal static class FixedAssetRules
{
    public static async Task<FixedAsset> GetAsync(IFixedAssetRepository assets, Guid id, CancellationToken cancellationToken)
    {
        var asset = await assets.GetByIdAsync(id, cancellationToken) ?? throw new NotFoundException("Fixed asset", id);
        return asset.IsVoided ? throw new DomainException("This asset is off the register. · الأصل محذوف من السجل.") : asset;
    }
}

// Where a fixed asset bought was paid from: the safe or the bank (a safe entry), or not through the
// treasury at all, owned already when the register started.
public enum AssetPaymentSource
{
    Safe = 1,
    Bank = 2,
    OwnedAlready = 3,
}
```


> 📄 **`backend/src/Costing.Infrastructure/Persistence/FixedAssetPersistence.cs`** — 68 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.FixedAssets;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Persistence;

// The fixed assets register: one row per asset, the safe entries that bought and sold it beside it.
internal sealed class FixedAssetConfiguration : IEntityTypeConfiguration<FixedAsset>
{
    public void Configure(EntityTypeBuilder<FixedAsset> builder)
    {
        builder.ToTable("FixedAssets", CostingDbContext.CostingSchema);
        builder.Property(a => a.AssetCode).HasMaxLength(16);
        builder.Property(a => a.Name).HasMaxLength(FixedAsset.MaxNameLength);
        builder.Property(a => a.Category).IsEnumName();
        builder.Property(a => a.Status).IsEnumName();
        builder.Property(a => a.PaidFrom).IsEnumName();
        builder.Property(a => a.SaleFund).IsEnumName();
        builder.Property(a => a.Location).HasMaxLength(FixedAsset.MaxLocationLength);
        builder.Property(a => a.Notes).HasMaxLength(FixedAsset.MaxNotesLength);
        builder.Property(a => a.DisposalNotes).HasMaxLength(FixedAsset.MaxNotesLength);
        builder.Property(a => a.PurchaseCost).HasPrecision(18, 2);
        builder.Property(a => a.SalvageValue).HasPrecision(18, 2);
        builder.Property(a => a.SaleProceeds).HasPrecision(18, 2);
        builder.Property(a => a.CreatedBy).HasMaxLength(200);
        builder.Property(a => a.UpdatedBy).HasMaxLength(200);
        builder.Property(a => a.DisposedBy).HasMaxLength(200);
        builder.Property(a => a.VoidedBy).HasMaxLength(200);
        builder.Ignore(a => a.IsVoided);
        builder.Ignore(a => a.IsOwnedAlready);
        builder.Ignore(a => a.IsGone);
        builder.Ignore(a => a.DepreciableAmount);
        builder.Ignore(a => a.MonthlyDepreciation);
        builder.Ignore(a => a.FirstMonth);
        builder.Ignore(a => a.NetBookValueAtDisposal);
        builder.Ignore(a => a.GainOrLoss);
        builder.HasIndex(a => a.Number).IsUnique();
        builder.HasIndex(a => a.AssetCode).IsUnique();
        builder.HasOne<SafeTransaction>().WithMany().HasForeignKey(a => a.PurchaseTransactionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<SafeTransaction>().WithMany().HasForeignKey(a => a.SaleTransactionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => a.PurchaseTransactionId);
        builder.HasIndex(a => a.SaleTransactionId);
    }
}

internal sealed class FixedAssetRepository(CostingDbContext db) : IFixedAssetRepository
{
    public Task<FixedAsset?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.FixedAssets.SingleOrDefaultAsync(a => a.Id == id, cancellationToken);

    public void Add(FixedAsset aggregate) => db.FixedAssets.Add(aggregate);

    public async Task<IReadOnlyList<FixedAsset>> GetAllAsync(CancellationToken cancellationToken = default) =>
        await db.FixedAssets.Where(a => a.VoidedAtUtc == null).OrderBy(a => a.Number).ToListAsync(cancellationToken);

    public Task<FixedAsset?> GetByTransactionAsync(Guid transactionId, CancellationToken cancellationToken = default) =>
        db.FixedAssets.SingleOrDefaultAsync(a => a.PurchaseTransactionId == transactionId || a.SaleTransactionId == transactionId, cancellationToken);

    // Added in this unit of work and not saved yet counted too.
    public async Task<int> NextNumberAsync(CancellationToken cancellationToken = default)
    {
        var saved = await db.FixedAssets.MaxAsync(a => (int?)a.Number, cancellationToken) ?? 0;
        var pending = db.ChangeTracker.Entries<FixedAsset>().Where(e => e.State == EntityState.Added).Select(e => e.Entity.Number).DefaultIfEmpty(0).Max();
        return Math.Max(saved, pending) + 1;
    }
}
```


`FixedAssetService`: السجل في نهاية أي شهر (الكروت لما كان قائمًا وقتها، والإنفاق الرأسمالي للشهر بمصدره) و `MonthAsync` الذي تقرأه قائمة الدخل ونقطة التعادل والتكلفة الكلية للطبق.

> 📄 **`backend/src/Costing.Infrastructure/Reports/FixedAssetService.cs`** — 158 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.FixedAssets;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// One asset on the register as it stood at the end of a month (FixedAssetRegister.AsOf): what it
// cost, its straight-line depreciation (FixedAsset), what is charged of it so far and in the month,
// and what is left of its cost; how it was paid; and, disposed of or sold, when, for what, and the
// gain or loss on it.
public sealed record FixedAssetRow(
    Guid Id,
    string AssetCode,
    string Name,
    FixedAssetCategory Category,
    string? Location,
    string? Notes,
    DateOnly PurchaseDate,
    decimal PurchaseCost,
    decimal SalvageValue,
    int UsefulLifeMonths,
    decimal MonthlyDepreciation,
    int MonthsCharged,
    int MonthsLeft,
    decimal AccumulatedDepreciation,
    decimal NetBookValue,
    decimal DepreciationThisMonth,
    // The last month its life is charged in.
    DateOnly LastMonth,
    FixedAssetStatus Status,
    // Null: owned already when the register started, paid through no entry here.
    CashFund? PaidFrom,
    Guid? PurchaseTransactionId,
    DateOnly? DisposalDate,
    decimal? SaleProceeds,
    CashFund? SaleFund,
    Guid? SaleTransactionId,
    decimal? NetBookValueAtDisposal,
    decimal? GainOrLoss,
    string? DisposalNotes,
    string CreatedBy,
    DateTime CreatedAtUtc);

// What the register holds of one category at the end of the month.
public sealed record FixedAssetCategoryTotal(
    FixedAssetCategory Category, int Count, decimal Cost, decimal AccumulatedDepreciation, decimal NetBookValue, decimal DepreciationThisMonth);

// The fixed assets register (سجل الأصول الثابتة) at the end of a month. The cards count what was
// still held then (bought by then, not disposed of or sold by then):
//
//   Total assets cost        = Σ purchase cost
//   Accumulated depreciation = Σ depreciation charged up to and including the month
//   Net book value           = total assets cost − accumulated depreciation
//
// Depreciation this month is what the month's profit and loss is charged, every asset's share
// (FixedAsset.DepreciationFor): its monthly run rate. Below the operating profit with the disposals'
// gains and losses (DisposalGainOrLoss: what the assets disposed of or sold in the month brought
// in, less what was left of their cost then).
//
// The month's investing cash (CAPEX): what was paid for the assets bought in it, out of the safe and
// the bank, and what the assets sold in it brought in. Never in the profit and loss.
public sealed record FixedAssetRegister(
    int Year,
    int Month,
    DateOnly AsOf,
    decimal TotalCost,
    decimal AccumulatedDepreciation,
    decimal NetBookValue,
    decimal DepreciationThisMonth,
    int ActiveCount,
    int FullyDepreciatedCount,
    int DisposedCount,
    decimal BoughtFromSafe,
    decimal BoughtFromBank,
    decimal OwnedAlreadyAdded,
    decimal SaleProceeds,
    decimal DisposalGainOrLoss,
    IReadOnlyList<FixedAssetCategoryTotal> Categories,
    IReadOnlyList<FixedAssetRow> Assets,
    IReadOnlyList<string> Locations);

// One month's fixed assets on the profit and loss: their depreciation, and the gains and losses on
// what was disposed of or sold in it.
public sealed record AssetMonth(decimal Depreciation, decimal DisposalGainOrLoss, int Assets);

// The fixed assets register and what it puts on the profit and loss.
public sealed class FixedAssetService(CostingDbContext db, IBusinessCalendar clock)
{
    public async Task<FixedAssetRegister> GetRegisterAsync(int? year, int? month, CancellationToken cancellationToken)
    {
        var today = clock.BusinessDateOf(DateTime.UtcNow);
        var first = year is { } y && month is { } m
            ? (m is >= 1 and <= 12 && y is >= 2000 and <= 2100 ? new DateOnly(y, m, 1) : throw new DomainException("Choose a month."))
            : FixedAsset.MonthOf(today);
        var last = first.AddMonths(1).AddDays(-1);

        var assets = await db.FixedAssets.AsNoTracking().Where(a => a.VoidedAtUtc == null && a.PurchaseDate <= last)
            .OrderBy(a => a.Number).ToListAsync(cancellationToken);
        var rows = assets.Select(a => Row(a, first)).ToList();
        var held = rows.Where(r => r.Status is FixedAssetStatus.Active or FixedAssetStatus.FullyDepreciated).ToList();
        var boughtIn = assets.Where(a => a.PurchaseDate >= first).ToList();
        var goneIn = assets.Where(a => a is { IsGone: true, DisposalDate: { } d } && d >= first && d <= last).ToList();

        var categories = held.GroupBy(r => r.Category).OrderBy(g => g.Key)
            .Select(g => new FixedAssetCategoryTotal(
                g.Key, g.Count(), Money(g.Sum(r => r.PurchaseCost)), Money(g.Sum(r => r.AccumulatedDepreciation)), Money(g.Sum(r => r.NetBookValue)),
                Money(g.Sum(r => r.DepreciationThisMonth))))
            .ToList();
        var locations = await db.FixedAssets.AsNoTracking().Where(a => a.Location != null && a.VoidedAtUtc == null)
            .Select(a => a.Location!).Distinct().OrderBy(l => l).ToListAsync(cancellationToken);

        return new FixedAssetRegister(
            first.Year, first.Month, last,
            Money(held.Sum(r => r.PurchaseCost)), Money(held.Sum(r => r.AccumulatedDepreciation)), Money(held.Sum(r => r.NetBookValue)),
            Money(rows.Sum(r => r.DepreciationThisMonth)),
            held.Count(r => r.Status == FixedAssetStatus.Active), held.Count(r => r.Status == FixedAssetStatus.FullyDepreciated),
            rows.Count(r => r.Status is FixedAssetStatus.Disposed or FixedAssetStatus.Sold),
            Money(boughtIn.Where(a => a.PaidFrom == CashFund.Safe).Sum(a => a.PurchaseCost)),
            Money(boughtIn.Where(a => a.PaidFrom == CashFund.Bank).Sum(a => a.PurchaseCost)),
            Money(boughtIn.Where(a => a.PaidFrom == null).Sum(a => a.PurchaseCost)),
            Money(goneIn.Sum(a => a.SaleProceeds ?? 0)),
            Money(goneIn.Sum(a => a.GainOrLoss ?? 0)),
            categories, rows, locations);
    }

    // A month's depreciation and disposal gains and losses, for its profit and loss.
    public async Task<AssetMonth> MonthAsync(DateOnly anyDay, CancellationToken cancellationToken)
    {
        var first = FixedAsset.MonthOf(anyDay);
        var last = first.AddMonths(1).AddDays(-1);
        var assets = await db.FixedAssets.AsNoTracking().Where(a => a.VoidedAtUtc == null && a.PurchaseDate <= last).ToListAsync(cancellationToken);
        return new AssetMonth(
            Money(assets.Sum(a => a.DepreciationFor(first))),
            Money(assets.Where(a => a is { IsGone: true, DisposalDate: { } d } && d >= first && d <= last).Sum(a => a.GainOrLoss ?? 0)),
            assets.Count);
    }

    // An asset's code, once it is on the register.
    public async Task<string?> CodeOfAsync(Guid id, CancellationToken cancellationToken) =>
        await db.FixedAssets.AsNoTracking().Where(a => a.Id == id).Select(a => a.AssetCode).SingleOrDefaultAsync(cancellationToken);

    private static FixedAssetRow Row(FixedAsset a, DateOnly month)
    {
        var charged = a.MonthsChargedThrough(month);
        var status = a.StatusAsOf(month);
        var gone = status is FixedAssetStatus.Disposed or FixedAssetStatus.Sold;
        return new FixedAssetRow(
            a.Id, a.AssetCode, a.Name, a.Category, a.Location, a.Notes, a.PurchaseDate, a.PurchaseCost, a.SalvageValue, a.UsefulLifeMonths,
            a.MonthlyDepreciation, charged, gone ? 0 : a.UsefulLifeMonths - charged, Money(a.AccumulatedThrough(month)), Money(a.NetBookValueThrough(month)),
            Money(a.DepreciationFor(month)), a.FirstMonth.AddMonths(a.UsefulLifeMonths - 1), status, a.PaidFrom, a.PurchaseTransactionId,
            gone ? a.DisposalDate : null, gone ? a.SaleProceeds : null, gone ? a.SaleFund : null, gone ? a.SaleTransactionId : null,
            gone ? Money(a.NetBookValueAtDisposal) : null, gone ? Money(a.GainOrLoss) : null, gone ? a.DisposalNotes : null, a.CreatedBy, a.CreatedAtUtc);
    }
}
```


> 📄 **`backend/src/Costing.Infrastructure/Excel/FixedAssetWorkbook.cs`** — 74 سطر

```csharp
using Costing.Domain.FixedAssets;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Excel;

// The fixed assets register as a workbook (سجل الأصول الثابتة): every asset as the screen shows it at
// the end of the month, held ones totalled, then what each category holds.
public static class FixedAssetWorkbook
{
    public static string FileName(FixedAssetRegister register) => $"fixed-assets-{register.Year:0000}-{register.Month:00}.xlsx";

    public static Stream Build(FixedAssetRegister register)
    {
        var asOf = $"At {register.AsOf:d MMM yyyy} · straight-line: (cost − salvage value) ÷ useful life, a month at a time from the month bought";
        var held = register.Assets.Where(a => a.Status is FixedAssetStatus.Active or FixedAssetStatus.FullyDepreciated).ToList();
        var assets = new ReportSheet(
            "Register", "Fixed assets register · سجل الأصول الثابتة", asOf,
            [
                new("Asset code · كود الأصل"), new("Name · الاسم"), new("Category · الفئة"), new("Location · الموقع"),
                new("Purchase date · تاريخ الشراء", ReportWorkbook.Date), new("Cost · التكلفة", ReportWorkbook.Money),
                new("Salvage value · القيمة التخريدية", ReportWorkbook.Money), new("Useful life (months) · العمر الإنتاجي"),
                new("Monthly depr. · القسط الشهري", ReportWorkbook.Money), new("Months charged · الأشهر المحملة"),
                new("Depr. this month · إهلاك الشهر", ReportWorkbook.Money), new("Accumulated depr. · مجمع الإهلاك", ReportWorkbook.Money),
                new("Net book value · القيمة الدفترية", ReportWorkbook.Money), new("Status · الحالة"), new("Paid from · مصدر الدفع"),
                new("Disposed on · تاريخ الاستبعاد", ReportWorkbook.Date), new("Sold for · قيمة البيع", ReportWorkbook.Money),
                new("Gain / (loss) · ربح / (خسارة)", ReportWorkbook.Money),
            ],
            [
                .. register.Assets.Select(a => new ReportRow(
                    [a.AssetCode, a.Name, CategoryName(a.Category), a.Location, a.PurchaseDate, a.PurchaseCost, a.SalvageValue, a.UsefulLifeMonths,
                     a.MonthlyDepreciation, a.MonthsCharged, a.DepreciationThisMonth, a.AccumulatedDepreciation, a.NetBookValue, StatusName(a.Status),
                     PaidFromName(a.PaidFrom), a.DisposalDate, a.SaleProceeds, a.GainOrLoss],
                    Flagged: a.GainOrLoss < 0)),
                new ReportRow(
                    ["", "Held · الأصول القائمة", null, null, null, held.Sum(a => a.PurchaseCost), null, null, null, null,
                     register.DepreciationThisMonth, register.AccumulatedDepreciation, register.NetBookValue],
                    ReportRowKind.Total),
            ]);
        var categories = new ReportSheet(
            "By category", "What each category holds · الأصول حسب الفئة", asOf,
            [
                new("Category · الفئة"), new("Assets · العدد"), new("Cost · التكلفة", ReportWorkbook.Money),
                new("Accumulated depr. · مجمع الإهلاك", ReportWorkbook.Money), new("Net book value · القيمة الدفترية", ReportWorkbook.Money),
                new("Depr. this month · إهلاك الشهر", ReportWorkbook.Money),
            ],
            [
                .. register.Categories.Select(c => new ReportRow(
                    [CategoryName(c.Category), c.Count, c.Cost, c.AccumulatedDepreciation, c.NetBookValue, c.DepreciationThisMonth])),
                new ReportRow(
                    ["Total · الإجمالي", register.Categories.Sum(c => c.Count), register.TotalCost, register.AccumulatedDepreciation, register.NetBookValue,
                     register.Categories.Sum(c => c.DepreciationThisMonth)],
                    ReportRowKind.Total),
            ]);
        return ReportWorkbook.Build([assets, categories]);
    }

    private static string CategoryName(FixedAssetCategory category) => Costing.Application.Treasury.TreasuryNames.Category(category);

    private static string StatusName(FixedAssetStatus status) => status switch
    {
        FixedAssetStatus.Active => "Active · نشط",
        FixedAssetStatus.FullyDepreciated => "Fully depreciated · مهلك بالكامل",
        FixedAssetStatus.Disposed => "Disposed · مستبعد",
        _ => "Sold · مباع",
    };

    private static string PaidFromName(CashFund? fund) => fund switch
    {
        CashFund.Safe => "Safe · الخزنة",
        CashFund.Bank => "Bank · البنك",
        _ => "Owned already · أصل قائم",
    };
}
```


`FixedAssetsController` (`api/financials/fixed-assets`): الشراء والبيع يتحولان إلى `SafeVoucher` ويرسلان `RecordSafeVoucherCommand` (200 أو 202)، والباقي أوامر مباشرة.

> 📄 **`backend/src/Costing.Api/Controllers/FixedAssetsController.cs`** — 156 سطر

```csharp
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Approvals;
using Costing.Application.FixedAssets;
using Costing.Application.Treasury;
using Costing.Domain.Access;
using Costing.Domain.FixedAssets;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// The fixed assets register (سجل الأصول الثابتة) on Financials. Buying an asset (CAPEX) out of the
// safe or the bank, or selling one for money, is a safe entry: entered at once for a manager (200),
// asked of one for anyone else (202), voided as any entry is (a deletion request, module Treasury,
// on its entry). What moves no cash is a manager's: an asset owned already, its details changed, a
// write-off, that undone, one owned already taken off.
[ApiController]
[Route("api/financials/fixed-assets")]
[Authorize(Policy = Permissions.InventoryManage)]
[CostingTab(CostingTabs.Financials)]
public sealed class FixedAssetsController(ISender sender, FixedAssetService assets) : ControllerBase
{
    private const string ManagersOnly =
        "This moves no cash but changes the profit and loss: it is a manager's. · هذا الإجراء للمدير.";

    // The register at the end of a month (this one when none is chosen).
    [HttpGet]
    public Task<FixedAssetRegister> GetRegister([FromQuery] int? year, [FromQuery] int? month, CancellationToken cancellationToken) =>
        assets.GetRegisterAsync(year, month, cancellationToken);

    [HttpGet("export")]
    public async Task<IActionResult> Export([FromQuery] int? year, [FromQuery] int? month, CancellationToken cancellationToken)
    {
        var register = await assets.GetRegisterAsync(year, month, cancellationToken);
        return File(FixedAssetWorkbook.Build(register), ReportWorkbook.ContentType, FixedAssetWorkbook.FileName(register));
    }

    // An asset bought (شراء أصل ثابت): out of the safe or the bank on the day, or owned already.
    [HttpPost]
    public async Task<IActionResult> Acquire(AcquireFixedAssetRequest request, CancellationToken cancellationToken)
    {
        var input = new FixedAssetInput(request.Name, request.Category, request.UsefulLifeMonths, request.SalvageValue, request.Location, request.Notes);
        if (request.PaidFrom == AssetPaymentSource.OwnedAlready)
        {
            if (!CanApprove)
                return Problem(statusCode: StatusCodes.Status403Forbidden, title: "A manager's.", detail: ManagersOnly);
            var saved = await sender.Send(
                new RegisterOwnedAssetCommand(request.AssetId, input, request.PurchaseDate, request.PurchaseCost, StaffName), cancellationToken);
            return Ok(new FixedAssetResult(ApprovalOutcome.Applied, saved.Id, saved.AssetCode, null, null));
        }

        var voucher = new SafeVoucher(
            request.TransactionId, SafeTransactionKind.AssetPurchase, request.PurchaseCost, request.PurchaseDate, Notes: request.Notes,
            Fund: request.PaidFrom == AssetPaymentSource.Bank ? CashFund.Bank : CashFund.Safe, FixedAssetId: request.AssetId, Asset: input);
        return await RecordAsync(request.RequestId, voucher, request.AssetId, request.Reason, cancellationToken);
    }

    [HttpPut("{assetId:guid}")]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public async Task<FixedAssetSaved> Change(Guid assetId, ChangeFixedAssetRequest request, CancellationToken cancellationToken) =>
        await sender.Send(new ChangeFixedAssetCommand(
            assetId, new FixedAssetInput(request.Name, request.Category, request.UsefulLifeMonths, request.SalvageValue, request.Location, request.Notes),
            request.PurchaseDate, request.PurchaseCost, StaffName), cancellationToken);

    // Disposed of or sold (استبعاد أو بيع الأصل): its depreciation stops. Sold for money, what it
    // brought in goes into the safe or the bank by a safe entry; for nothing, it is written off.
    [HttpPost("{assetId:guid}/dispose")]
    public async Task<IActionResult> Dispose(Guid assetId, DisposeFixedAssetRequest request, CancellationToken cancellationToken)
    {
        if (request.SaleProceeds is > 0 and var proceeds)
        {
            var voucher = new SafeVoucher(
                request.TransactionId, SafeTransactionKind.AssetSale, proceeds, request.Date, Notes: request.Notes,
                Fund: request.Fund ?? CashFund.Safe, FixedAssetId: assetId);
            return await RecordAsync(request.RequestId, voucher, assetId, request.Reason, cancellationToken);
        }
        if (!CanApprove)
            return Problem(statusCode: StatusCodes.Status403Forbidden, title: "A manager's.", detail: ManagersOnly);
        var saved = await sender.Send(new WriteOffFixedAssetCommand(assetId, request.Date, request.Notes, StaffName), cancellationToken);
        return Ok(new FixedAssetResult(ApprovalOutcome.Applied, saved.Id, saved.AssetCode, null, null));
    }

    // A write-off undone. A sale is undone by voiding its entry.
    [HttpPost("{assetId:guid}/reinstate")]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<FixedAssetSaved> Reinstate(Guid assetId, CancellationToken cancellationToken) =>
        sender.Send(new ReinstateFixedAssetCommand(assetId, StaffName), cancellationToken);

    // One owned already, off the register. A paid one goes with its purchase voided.
    [HttpDelete("{assetId:guid}")]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public async Task<IActionResult> Remove(Guid assetId, CancellationToken cancellationToken)
    {
        await sender.Send(new RemoveFixedAssetCommand(assetId, StaffName), cancellationToken);
        return NoContent();
    }

    private async Task<IActionResult> RecordAsync(Guid requestId, SafeVoucher voucher, Guid assetId, string? reason, CancellationToken cancellationToken)
    {
        var result = await sender.Send(
            new RecordSafeVoucherCommand(requestId, voucher, reason, UserClaims.IdOf(User) ?? string.Empty, StaffName, CanApprove), cancellationToken);
        return result.Outcome == ApprovalOutcome.Requested
            ? Accepted(new FixedAssetResult(result.Outcome, assetId, null, null, result.Request))
            : Ok(new FixedAssetResult(result.Outcome, assetId, await assets.CodeOfAsync(assetId, cancellationToken), result.Transaction, null));
    }

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;

    private bool CanApprove => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide);
}

// Applied: the asset is on the register (AssetCode), its payment made (Transaction, when paid).
// Requested: it waits for a manager (Request).
public sealed record FixedAssetResult(
    ApprovalOutcome Outcome, Guid AssetId, string? AssetCode, SafeTransactionDto? Transaction, ApprovalRequestDto? Request);

// AssetId and TransactionId are made by the till, with RequestId.
public sealed record AcquireFixedAssetRequest(
    Guid RequestId,
    Guid AssetId,
    Guid TransactionId,
    string Name,
    FixedAssetCategory Category,
    DateOnly PurchaseDate,
    decimal PurchaseCost,
    int UsefulLifeMonths,
    decimal SalvageValue = 0,
    string? Location = null,
    string? Notes = null,
    AssetPaymentSource PaidFrom = AssetPaymentSource.Safe,
    string? Reason = null);

// Cost and purchase date: an asset owned already's only.
public sealed record ChangeFixedAssetRequest(
    string Name,
    FixedAssetCategory Category,
    int UsefulLifeMonths,
    decimal SalvageValue = 0,
    string? Location = null,
    string? Notes = null,
    DateOnly? PurchaseDate = null,
    decimal? PurchaseCost = null);

// SaleProceeds more than nothing: sold, into the safe or the bank (Fund). Otherwise written off.
public sealed record DisposeFixedAssetRequest(
    Guid RequestId,
    Guid TransactionId,
    DateOnly Date,
    decimal? SaleProceeds = null,
    CashFund? Fund = null,
    string? Notes = null,
    string? Reason = null);
```


## 2. الموظفون والسلف والرواتب والخصومات

`Staff.cs`: الموظفون كأسماء ووظائف. بدون ربط HR: يُضافون هنا (ومن نافذة السلفة في تقفيل اليوم). مع الربط: **من HR فقط**، لا تعديل هنا (الفصل 07). السلفة ليست مصروفًا؛ الراتب المصروف (`SalaryPayment`) تكلفة عمالة لشهره، أو مسير HR المعتمد بدلًا منه. والخصومات (عجز خزنة، خصم على موظف) سجل هنا يُرسل لـ HR كخصم من راتبه حين يكون الربط مفعّلًا.

> 📄 **`backend/src/Costing.Application/Staff/Staff.cs`** — 95 سطر

```csharp
using MediatR;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Integrations;
using Costing.Domain.Staff;

namespace Costing.Application.Staff;

// Staff (الموظفين): who the safe pays advances and salaries to. Only their names and jobs: the people
// themselves are the HR system's. With HR linked, they come from HR (SyncedEmployees, each a staff
// member here), named, numbered and placed in a department as HR has them, and are changed there;
// unlinked, they are kept here, and anyone working the end of the day can add one.

// HrEmployeeId, Code, Department, Branch: theirs on HR, for one who comes from HR.
public sealed record StaffMemberDto(
    Guid Id, string Name, string? JobTitle, bool IsActive, Guid? HrEmployeeId = null, string? Code = null, string? Department = null, string? Branch = null)
{
    public static StaffMemberDto From(StaffMember s, SyncedEmployee? hr = null) =>
        new(s.Id, s.Name, s.JobTitle, s.IsActive, hr?.HrEmployeeId, hr?.Code, hr?.Department, hr?.Branch);
}

// Left ones too, by name.
public sealed record GetStaffQuery : IRequest<IReadOnlyList<StaffMemberDto>>;

internal sealed class GetStaffHandler(IStaffMemberRepository staff, ISyncedEmployeeRepository synced) : IRequestHandler<GetStaffQuery, IReadOnlyList<StaffMemberDto>>
{
    public async Task<IReadOnlyList<StaffMemberDto>> Handle(GetStaffQuery request, CancellationToken cancellationToken)
    {
        var fromHr = (await synced.GetAllAsync(cancellationToken)).ToDictionary(e => e.StaffMemberId);
        return (await staff.GetAllAsync(cancellationToken)).Select(s => StaffMemberDto.From(s, fromHr.GetValueOrDefault(s.Id))).ToList();
    }
}

// Added (an id not there yet, made by the app) or changed; IsActive false for one who has left.
// One from HR is changed on HR while the link is on.
public sealed record SaveStaffMemberCommand(Guid Id, string Name, string? JobTitle, bool IsActive) : IRequest<StaffMemberDto>, IRetryOnConflict;

internal sealed class SaveStaffMemberHandler(IStaffMemberRepository staff, ISyncedEmployeeRepository synced, IHrLinkStore links, IUnitOfWork unitOfWork)
    : IRequestHandler<SaveStaffMemberCommand, StaffMemberDto>
{
    public async Task<StaffMemberDto> Handle(SaveStaffMemberCommand request, CancellationToken cancellationToken)
    {
        var member = await staff.GetByIdAsync(request.Id, cancellationToken);
        var hr = member is null ? null : await synced.GetByStaffMemberAsync(member.Id, cancellationToken);
        if (hr is not null && (await links.GetAsync(cancellationToken)).Enabled)
            throw new DomainException($"{member!.Name} comes from HR: change them there, and sync. · بيانات الموظف من الموارد البشرية.");
        if (member is null)
        {
            member = new StaffMember(request.Id, request.Name, request.JobTitle);
            staff.Add(member);
        }
        else
        {
            member.Change(request.Name, request.JobTitle);
        }

        if (request.IsActive)
            member.Reactivate();
        else
            member.Deactivate();
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return StaffMemberDto.From(member, hr);
    }
}

// Added from the end of the day, to advance at once: a name, and a job if given. Only while HR is
// not linked: linked, the staff are HR's. Id made by the app; one of the same name kept here is
// theirs, not made again.
public sealed record AddLocalStaffMemberCommand(Guid Id, string Name, string? JobTitle) : IRequest<StaffMemberDto>, IRetryOnConflict;

internal sealed class AddLocalStaffMemberHandler(IStaffMemberRepository staff, IHrLinkStore links, IUnitOfWork unitOfWork)
    : IRequestHandler<AddLocalStaffMemberCommand, StaffMemberDto>
{
    public async Task<StaffMemberDto> Handle(AddLocalStaffMemberCommand request, CancellationToken cancellationToken)
    {
        if ((await links.GetAsync(cancellationToken)).Enabled)
            throw new DomainException("The staff come from HR while it is linked: add them there, then sync. · أضف الموظف في الموارد البشرية.");
        if (await staff.GetByIdAsync(request.Id, cancellationToken) is { } made)
            return StaffMemberDto.From(made);
        var name = request.Name?.Trim() ?? string.Empty;
        if ((await staff.GetAllAsync(cancellationToken)).FirstOrDefault(m => string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase)) is { } same)
        {
            if (!same.IsActive)
            {
                same.Reactivate();
                await unitOfWork.SaveChangesAsync(cancellationToken);
            }
            return StaffMemberDto.From(same);
        }
        var member = new StaffMember(request.Id, name, request.JobTitle);
        staff.Add(member);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return StaffMemberDto.From(member);
    }
}
```


`FinancialsController` (`api/financials`): الدفتر، التمويل، المطابقة، يومية الإيراد، المصروفات، ديون الموردين وكشوفهم، السلف، الضريبة، وتسجيل القيود.

> 📄 **`backend/src/Costing.Api/Controllers/FinancialsController.cs`** — 173 سطر

```csharp
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Domain.Access;
using Costing.Application.Approvals;
using Costing.Application.Treasury;
using Costing.Domain.Treasury;
using Costing.Api.Auth;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// The treasury (الماليات): the safe, where its money came from, each day's cash and its
// reconciliation with the sales, expense vouchers, and what is owed to suppliers and paid them.
// Whoever keeps the books sees and enters it; a safe entry by anyone who may not approve waits for
// a manager (202), and moves no cash until then. Voiding an entry is a deletion request
// (POST /api/inventory/deletion-requests, module Treasury). The tax and service settings are a
// manager's to change.
[ApiController]
[Route("api/financials")]
[Authorize(Policy = Permissions.InventoryManage)]
public sealed class FinancialsController(ISender sender, TreasuryService treasury, SupplierAccountsService accounts) : ControllerBase
{
    // The till's business day: the date a safe entry is given unless another is chosen. Between
    // midnight and the hour the business day starts it is still yesterday.
    [HttpGet("today")]
    [CostingTab(CostingTabs.All)]
    public object GetToday() => new { Today = treasury.Today };

    [HttpGet("safe")]
    [CostingTab(CostingTabs.Financials)]
    public Task<SafeMonth> GetSafe([FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken) =>
        treasury.GetSafeAsync(year, month, cancellationToken);

    // The tax the takings collected, what was paid over, and what is still owed, held in the safe.
    [HttpGet("tax")]
    [CostingTab(CostingTabs.Financials)]
    public Task<TaxPosition> GetTax(CancellationToken cancellationToken) => treasury.GetTaxPositionAsync(null, cancellationToken);

    [HttpGet("funding")]
    [CostingTab(CostingTabs.Financials)]
    public Task<FundingReport> GetFunding([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetFundingAsync(from, to, cancellationToken);

    [HttpGet("revenue")]
    [CostingTab(CostingTabs.Financials)]
    public Task<DayRevenueReport> GetDayRevenue([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetDayRevenueAsync(from, to, cancellationToken);

    // Each day's cash before tax against the cash its sales should have brought in.
    [HttpGet("reconciliation")]
    [CostingTab(CostingTabs.Financials)]
    public Task<ReconciliationReport> GetReconciliation([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetReconciliationAsync(from, to, cancellationToken);

    // A day's takings before they are entered: what was paid out of them, which entering them takes off.
    [HttpGet("takings")]
    [CostingTab(CostingTabs.Financials)]
    public Task<TakingsPreview> GetTakingsPreview([FromQuery] DateOnly day, CancellationToken cancellationToken) =>
        treasury.GetTakingsPreviewAsync(day, cancellationToken);

    // Each day's takings as they were spent: the invoices paid out of them, and what reached the safe.
    [HttpGet("daily-cash")]
    [CostingTab(CostingTabs.Financials)]
    public Task<DailyCashReport> GetDailyCash([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetDailyCashAsync(from, to, cancellationToken);

    [HttpGet("settings")]
    [CostingTab(CostingTabs.Financials)]
    public Task<FinancialSettingsDto> GetSettings(CancellationToken cancellationToken) => treasury.GetSettingsAsync(cancellationToken);

    [HttpPut("settings")]
    [CostingTab(CostingTabs.Financials)]
    [Authorize(Policy = Permissions.ApprovalDecide)]
    public Task<FinancialSettingsDto> SaveSettings(SaveFinancialSettingsRequest request, CancellationToken cancellationToken) =>
        treasury.SaveSettingsAsync(request, StaffName, cancellationToken);

    [HttpGet("expense-vouchers")]
    [CostingTab(CostingTabs.Financials)]
    public Task<ExpenseVoucherReport> GetExpenseVouchers([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetExpenseVouchersAsync(from, to, cancellationToken);

    [HttpGet("suppliers")]
    [CostingTab(CostingTabs.Financials | CostingTabs.Purchases)]
    public Task<IReadOnlyList<SupplierBalance>> GetSupplierBalances(CancellationToken cancellationToken) =>
        treasury.GetSupplierBalancesAsync(cancellationToken);

    // What is owed to each supplier by how long it has been due (أعمار ديون الموردين), on a day
    // (today when none): Current, 1–30, 31–60, 61–90 and 90+ days past due.
    [HttpGet("ap-aging")]
    [CostingTab(CostingTabs.Financials | CostingTabs.Purchases)]
    public Task<ApAgingReport> GetApAging([FromQuery] DateOnly? asOf, CancellationToken cancellationToken) =>
        accounts.GetAgingAsync(asOf, cancellationToken);

    [HttpGet("suppliers/{supplierId:guid}")]
    [CostingTab(CostingTabs.Financials | CostingTabs.Purchases)]
    public async Task<ActionResult<SupplierStatement>> GetSupplierStatement(Guid supplierId, CancellationToken cancellationToken) =>
        await treasury.GetSupplierStatementAsync(supplierId, cancellationToken) is { } statement ? statement : NotFound();

    // Employees' advances (السلفيات) paid in a period, and the payroll month each is deducted in.
    // Salaries show here: whoever keeps the books may see them only with HR.
    [HttpGet("advances")]
    [CostingTab(CostingTabs.Financials)]
    public Task<IReadOnlyList<AdvanceRow>> GetAdvances([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetAdvancesAsync(from, to, cancellationToken);

    [HttpGet("supplier-payments")]
    [CostingTab(CostingTabs.Financials)]
    public Task<IReadOnlyList<SupplierPaymentRow>> GetSupplierPayments([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        treasury.GetSupplierPaymentsAsync(from, to, cancellationToken);

    // What a supplier was owed before the treasury: no cash moves, so it is entered at once.
    [HttpPost("suppliers/{supplierId:guid}/opening-balance")]
    [CostingTab(CostingTabs.Financials)]
    public async Task<IActionResult> SetSupplierOpeningBalance(Guid supplierId, SupplierOpeningBalanceRequest request, CancellationToken cancellationToken)
    {
        await sender.Send(new SetSupplierOpeningBalanceCommand(
            request.EntryId, supplierId, request.Owed, request.Date ?? treasury.Today, StaffName), cancellationToken);
        return NoContent();
    }

    // A safe entry: opening balance, funding, a day's takings moved in, an expense voucher, a
    // supplier payment, an employee's advance or their salary. Entered at once for a manager (200, the entry); asked of one for anyone
    // else (202, the request). RequestId and TransactionId are made by the till.
    [HttpPost("vouchers")]
    [CostingTab(CostingTabs.Financials | CostingTabs.Purchases)]
    public async Task<IActionResult> RecordVoucher(SafeVoucherRequest request, CancellationToken cancellationToken)
    {
        var result = await sender.Send(new RecordSafeVoucherCommand(
            request.RequestId,
            new SafeVoucher(
                request.TransactionId, request.Kind, request.Amount, request.Date ?? treasury.Today, request.Source, request.RevenueDate,
                request.SupplierId, request.ExpenseItemId, null, request.Notes, request.IncludesTax, EmployeeId: request.EmployeeId,
                PayrollMonth: request.PayrollMonth, CardAmount: request.CardAmount, TaxAmount: request.TaxAmount, VoidsAmount: request.VoidsAmount,
                DiscountsAmount: request.DiscountsAmount, DiscountReasons: request.DiscountReasons),
            request.Reason, UserClaims.IdOf(User) ?? string.Empty, StaffName, CanApprove), cancellationToken);
        return result.Outcome == ApprovalOutcome.Requested
            ? Accepted(new ApprovalResultDto(result.Outcome, result.Request!))
            : Ok(result.Transaction);
    }

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;

    private bool CanApprove => UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide);
}

public sealed record SafeVoucherRequest(
    Guid RequestId,
    Guid TransactionId,
    SafeTransactionKind Kind,
    decimal Amount,
    DateOnly? Date = null,
    FundingSource? Source = null,
    DateOnly? RevenueDate = null,
    Guid? SupplierId = null,
    Guid? ExpenseItemId = null,
    string? Notes = null,
    string? Reason = null,
    // A day's takings counted with the tax in them: taken off at the till's own rate.
    bool IncludesTax = false,
    // An advance's or a salary's employee; a salary's payroll month (its first day).
    Guid? EmployeeId = null,
    DateOnly? PayrollMonth = null,
    // A day's takings from its Z report: Amount is the cash; these, its card takings, the tax
    // collected in both, and the day's voids and refunds.
    decimal? CardAmount = null,
    decimal? TaxAmount = null,
    decimal? VoidsAmount = null,
    // The day's discounts and promos, and why: said, never collected.
    decimal? DiscountsAmount = null,
    IReadOnlyList<Costing.Domain.Sales.DiscountReason>? DiscountReasons = null);

public sealed record SupplierOpeningBalanceRequest(Guid EntryId, decimal Owed, DateOnly? Date = null);
```


### 2.1 أعمار ديون الموردين وكشف الحساب التفصيلي (`SupplierAccountsService`)

لكل مورد **مدة سداد** (`Supplier.PaymentTermsDays`، 0 إلى 365). **الأعمار:** المدفوعات تُخصم أولًا من الرصيد الافتتاحي (ما كان مستحقًا قبل الخزنة)، ثم من فواتير الآجل **الأقدم فالأحدث** (نفس منطق `TreasuryService.OpenInvoices`، صار `internal static` لهذا مع `Totals`). كل فاتورة باقٍ منها شيء تستحق في `تاريخها + مدة السداد`، وأيام التأخير يوم السؤال تضعها في شريحة: غير مستحق (≤ 0)، 1–30، 31–60، 61–90، أكثر من 90.

**كشف الحساب:** من يوم ليوم (افتراضيًا أول السنة): الرصيد الافتتاحي، ثم كل فاتورة آجل (دائن +) وكل فاتورة كاش (مدين ودائن معًا فلا يتحرك الرصيد؛ لاحظ `Include(i => i.Lines)` لأن إجمالي الفاتورة يُحسب من بنودها) وكل دفعة (مدين −)، بالترتيب ورصيد جارٍ بعد كل سطر، و `SourceId` يفتح الفاتورة أو السند في الواجهة.

```
الرصيد الختامي = الافتتاحي + فواتير الآجل − المدفوعات
```

> 📄 **`backend/src/Costing.Infrastructure/Reports/SupplierAccountsService.cs`** — 220 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// What the restaurant owes its suppliers, by how long it has been owed (أعمار ديون الموردين), and one
// supplier's account over a period (كشف حساب مورد تفصيلي).
//
// Aging: payments are set against what was owed before the treasury first, then the credit invoices
// oldest first (as the open invoices are). Each invoice still owed falls due its supplier's payment
// terms after its date; what was owed before the treasury is due from when it was entered. Days
// past due on the day asked: 0 or less is Current (not due), then 1–30, 31–60, 61–90 and 90+.
public sealed record ApAgingRow(
    Guid SupplierId,
    string Supplier,
    int PaymentTermsDays,
    decimal TotalOwed,
    decimal Current,
    decimal Days1To30,
    decimal Days31To60,
    decimal Days61To90,
    decimal Over90,
    int OpenInvoices,
    DateOnly? OldestDueDate);

public sealed record ApAgingReport(
    DateOnly AsOf,
    decimal TotalOwed,
    decimal Current,
    decimal Days1To30,
    decimal Days31To60,
    decimal Days61To90,
    decimal Over90,
    IReadOnlyList<ApAgingRow> Rows);

public enum SupplierAccountEntryKind
{
    // Owed before the treasury was kept.
    OpeningBalance = 1,
    CreditInvoice = 2,
    // Paid when posted, from the safe or a day's takings: owed and paid at once.
    CashInvoice = 3,
    Payment = 4,
}

// A line of the account: Owed (+, credit) adds to what is owed, Paid (−, debit) takes from it; a
// cash invoice is both. A payment carries its voucher's details, to open it where it is listed.
public sealed record SupplierAccountLine(
    Guid Id,
    DateOnly Date,
    SupplierAccountEntryKind Kind,
    string Reference,
    string Description,
    decimal Paid,
    decimal Owed,
    decimal Balance,
    Guid SourceId,
    bool IsReversal,
    string? RecordedBy = null,
    string? ApprovedBy = null,
    DateOnly? FromTakingsOf = null,
    string? Notes = null);

public sealed record SupplierAccount(
    Guid SupplierId,
    string Supplier,
    int PaymentTermsDays,
    DateOnly From,
    DateOnly To,
    decimal OpeningBalance,
    decimal CreditInvoices,
    decimal CashInvoices,
    decimal Payments,
    decimal ClosingBalance,
    IReadOnlyList<SupplierAccountLine> Lines,
    IReadOnlyList<OpenInvoice> OpenInvoices,
    // What was entered in the period as owed before the treasury was kept: added like an invoice.
    // Closing = opening + owed before + credit invoices − payments.
    decimal OwedBefore = 0);

public sealed class SupplierAccountsService(CostingDbContext db, IBusinessCalendar clock)
{
    public async Task<ApAgingReport> GetAgingAsync(DateOnly? asOf, CancellationToken cancellationToken)
    {
        var day = asOf ?? clock.BusinessDateOf(DateTime.UtcNow);
        var entries = await db.SupplierLedgerEntries.AsNoTracking().Where(l => l.BusinessDate <= day).ToListAsync(cancellationToken);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, cancellationToken);

        var rows = new List<ApAgingRow>();
        foreach (var group in entries.GroupBy(l => l.SupplierId))
        {
            var lines = group.OrderBy(l => l.BusinessDate).ThenBy(l => l.RecordedAtUtc).ToList();
            var (opening, credit, paid) = TreasuryService.Totals(lines);
            var balance = Money(opening + credit - paid);
            if (balance == 0)
                continue;
            var supplier = suppliers.GetValueOrDefault(group.Key);
            var terms = supplier?.PaymentTermsDays ?? 0;

            // What is still owed, each with the day it fell due.
            var owed = new List<(DateOnly Due, decimal Amount)>();
            var openingLeft = Math.Max(opening - paid, 0);
            if (openingLeft > 0)
                owed.Add((lines.Where(l => l.Kind == SupplierLedgerKind.OpeningBalance).Min(l => l.BusinessDate), openingLeft));
            var open = TreasuryService.OpenInvoices(lines, new Dictionary<Guid, PurchaseInvoice>());
            owed.AddRange(open.Select(i => (i.Date.AddDays(terms), i.Remaining)));

            decimal Bucket(int fromDays, int toDays) =>
                Money(owed.Where(o => day.DayNumber - o.Due.DayNumber is var late && late >= fromDays && late <= toDays).Sum(o => o.Amount));
            rows.Add(new ApAgingRow(
                group.Key, supplier?.Name ?? "A removed supplier", terms, balance,
                Bucket(int.MinValue, 0), Bucket(1, 30), Bucket(31, 60), Bucket(61, 90), Bucket(91, int.MaxValue),
                open.Count, owed.Count > 0 ? owed.Min(o => o.Due) : null));
        }

        rows = rows.OrderByDescending(r => r.Over90).ThenByDescending(r => r.TotalOwed).ThenBy(r => r.Supplier, StringComparer.CurrentCultureIgnoreCase).ToList();
        return new ApAgingReport(
            day, Money(rows.Sum(r => r.TotalOwed)), Money(rows.Sum(r => r.Current)), Money(rows.Sum(r => r.Days1To30)), Money(rows.Sum(r => r.Days31To60)),
            Money(rows.Sum(r => r.Days61To90)), Money(rows.Sum(r => r.Over90)), rows);
    }

    // One supplier's account from one day to another: what was owed coming in, every credit and
    // cash invoice and every payment in order with the balance after each, and what is owed going out.
    public async Task<SupplierAccount?> GetAccountAsync(Guid supplierId, DateOnly? from, DateOnly? to, CancellationToken cancellationToken)
    {
        if (await db.Suppliers.AsNoTracking().SingleOrDefaultAsync(s => s.Id == supplierId, cancellationToken) is not { } supplier)
            return null;
        var today = clock.BusinessDateOf(DateTime.UtcNow);
        var last = to ?? today;
        var first = from ?? new DateOnly(last.Year, 1, 1);
        if (last < first)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (last > first.AddYears(5))
            throw new DomainException("Choose five years at most. · خمس سنوات على الأكثر.");

        var ledger = await db.SupplierLedgerEntries.AsNoTracking()
            .Where(l => l.SupplierId == supplierId && l.BusinessDate <= last)
            .OrderBy(l => l.BusinessDate).ThenBy(l => l.RecordedAtUtc)
            .ToListAsync(cancellationToken);
        var before = ledger.Where(l => l.BusinessDate < first).ToList();
        var inPeriod = ledger.Where(l => l.BusinessDate >= first).ToList();

        // Cash invoices of the period: paid when posted, so owed and paid at once.
        var (firstUtc, _) = clock.Bounds(first);
        var (_, lastUtc) = clock.Bounds(last);
        var cash = await db.PurchaseInvoices.AsNoTracking().Include(i => i.Lines)
            .Where(i => i.SupplierId == supplierId && i.Status == PurchaseInvoiceStatus.Posted && i.PaymentMethod != PurchasePaymentMethod.Credit
                && ((i.InvoiceDate != null && i.InvoiceDate >= first && i.InvoiceDate <= last)
                    || (i.InvoiceDate == null && i.PostedAtUtc >= firstUtc && i.PostedAtUtc < lastUtc)))
            .ToListAsync(cancellationToken);

        var invoiceIds = inPeriod.Where(l => l.Kind == SupplierLedgerKind.CreditInvoice).Select(l => l.SourceId).Distinct().ToList();
        var invoices = await db.PurchaseInvoices.AsNoTracking().Where(i => invoiceIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id, cancellationToken);
        var paymentIds = inPeriod.Where(l => l.Kind == SupplierLedgerKind.Payment).Select(l => l.SourceId).Distinct().ToList();
        var payments = await db.SafeTransactions.AsNoTracking().Where(t => paymentIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, cancellationToken);

        var opening = Money(before.Sum(l => l.Amount));
        var rows = inPeriod
            .Select(l => (Date: l.BusinessDate, At: l.RecordedAtUtc, Line: Line(l, invoices, payments)))
            .Concat(cash.Select(i => (
                Date: i.InvoiceDate ?? clock.BusinessDateOf(i.PostedAtUtc ?? i.CreatedAtUtc), At: i.PostedAtUtc ?? i.CreatedAtUtc,
                Line: new SupplierAccountLine(
                    i.Id, i.InvoiceDate ?? clock.BusinessDateOf(i.PostedAtUtc ?? i.CreatedAtUtc), SupplierAccountEntryKind.CashInvoice,
                    i.SupplierInvoiceNumber is { } n ? $"Invoice {n}" : "Invoice",
                    i.PaymentMethod == PurchasePaymentMethod.DayRevenue ? "Cash invoice, paid from a day's takings · فاتورة نقدي من الإيراد"
                        : i.PaymentMethod == PurchasePaymentMethod.Safe ? "Cash invoice, paid from the safe · فاتورة نقدي من الخزنة"
                        : "Invoice before the treasury · فاتورة قبل الخزنة",
                    i.Total, i.Total, 0, i.Id, false))))
            .OrderBy(r => r.Date).ThenBy(r => r.At)
            .ToList();

        var balance = opening;
        var lines = rows.Select(r =>
        {
            balance += r.Line.Owed - r.Line.Paid;
            return r.Line with { Balance = Money(balance) };
        }).ToList();

        decimal Sum(SupplierLedgerKind kind) => Money(inPeriod.Where(l => l.Kind == kind).Sum(l => l.Amount));
        var open = TreasuryService.OpenInvoices(ledger, await db.PurchaseInvoices.AsNoTracking()
            .Where(i => i.SupplierId == supplierId && i.PaymentMethod == PurchasePaymentMethod.Credit).ToDictionaryAsync(i => i.Id, cancellationToken));
        return new SupplierAccount(
            supplierId, supplier.Name, supplier.PaymentTermsDays, first, last, opening, Sum(SupplierLedgerKind.CreditInvoice),
            Money(cash.Sum(i => i.Total)), -Sum(SupplierLedgerKind.Payment), Money(opening + inPeriod.Sum(l => l.Amount)), lines, open,
            Sum(SupplierLedgerKind.OpeningBalance));
    }

    private static SupplierAccountLine Line(
        SupplierLedgerEntry l, IReadOnlyDictionary<Guid, PurchaseInvoice> invoices, IReadOnlyDictionary<Guid, SafeTransaction> payments)
    {
        var owed = l.Amount > 0 ? l.Amount : 0;
        var paid = l.Amount < 0 ? -l.Amount : 0;
        string Voided(string what) => l.IsReversal ? $"Voided: {what} · ملغى" : what;
        switch (l.Kind)
        {
            case SupplierLedgerKind.OpeningBalance:
                return new SupplierAccountLine(l.Id, l.BusinessDate, SupplierAccountEntryKind.OpeningBalance, "Opening balance",
                    Voided("Owed before the treasury · رصيد سابق"), paid, owed, 0, l.SourceId, l.IsReversal, l.RecordedBy);
            case SupplierLedgerKind.CreditInvoice:
            {
                var number = invoices.GetValueOrDefault(l.SourceId)?.SupplierInvoiceNumber;
                return new SupplierAccountLine(l.Id, l.BusinessDate, SupplierAccountEntryKind.CreditInvoice, number is null ? "Invoice" : $"Invoice {number}",
                    Voided("Invoice on credit · فاتورة آجل"), paid, owed, 0, l.SourceId, l.IsReversal, l.RecordedBy);
            }
            default:
            {
                var voucher = payments.GetValueOrDefault(l.SourceId);
                var from = voucher?.RevenueDate is { } day ? $"from the takings of {day:d MMM} · من إيراد يوم" : "from the safe · من الخزنة";
                return new SupplierAccountLine(l.Id, l.BusinessDate, SupplierAccountEntryKind.Payment, "Payment voucher",
                    Voided($"Payment, {from}"), paid, owed, 0, l.SourceId, l.IsReversal, voucher?.RecordedBy ?? l.RecordedBy, voucher?.ApprovedBy,
                    voucher?.RevenueDate, voucher?.Notes);
            }
        }
    }
}
```


`SuppliersController` (`api/suppliers`): الكشف وملف Excel، لمن يعمل الماليات **أو** المشتريات. لماذا Controller مستقل؟ لأن `CostingTab` على مستوى الكلاس يُضاف (AND) لما على الـ endpoint، فلو وُضع في `FinancialsController` لرُفض موظف المشتريات.

> 📄 **`backend/src/Costing.Api/Controllers/SuppliersController.cs`** — 32 سطر

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Domain.Access;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// A supplier's account over a period (كشف حساب مورد تفصيلي): what was owed coming in, every credit
// and cash invoice and every payment with the balance after each, and what is owed going out; as a
// table, and as a workbook. From Purchases → Suppliers, Financials → Supplier debts and the AP aging.
[ApiController]
[Route("api/suppliers")]
[Authorize(Policy = Permissions.InventoryManage)]
[CostingTab(CostingTabs.Financials | CostingTabs.Purchases)]
public sealed class SuppliersController(SupplierAccountsService accounts) : ControllerBase
{
    // From the start of the year to today when the days are not given.
    [HttpGet("{supplierId:guid}/statement")]
    public async Task<ActionResult<SupplierAccount>> GetStatement(
        Guid supplierId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken) =>
        await accounts.GetAccountAsync(supplierId, from, to, cancellationToken) is { } account ? account : NotFound();

    [HttpGet("{supplierId:guid}/statement/sheet")]
    public async Task<IActionResult> GetStatementSheet(
        Guid supplierId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken) =>
        await accounts.GetAccountAsync(supplierId, from, to, cancellationToken) is { } account
            ? File(SupplierAccountWorkbook.Build(account), ReportWorkbook.ContentType,
                $"statement-{account.From:yyyy-MM-dd}-to-{account.To:yyyy-MM-dd}.xlsx")
            : NotFound();
}
```


---

## 3. محركات التحليلات الذكية (`IntelligenceService`) وهندسة المنيو وكارتة الصنف

كل الكميات **بوحدة الشراء** (كجم، لتر، كرتونة) وكل الأسعار لها.

### 3.1 انحراف أسعار الشراء وأثره على الأطباق (PPV)

```text
لكل خامة اشتُريت في الفترة:
  الأساس (Baseline) = المتوسط المتحرك **قبل** الفترة، يُعاد بناؤه من دفتر الحركات
  الأحدث (Latest)   = آخر سعر صافٍ مدفوع = Cost ÷ Quantity لآخر بند فاتورة (بعد الخصمين)
  التغير            = الأحدث − الأساس ، والنسبة = التغير ÷ الأساس
  أثر الفترة         = التغير × الكمية المشتراة
  الأثر على كل طبق  = التغير لكل وحدة أساسية × كمية الخامة في الطبق (مباشرة أو داخل مصنّع، عبر MaterialExplosion)
```

`AverageAt` يعيد بناء المتوسط من الحركات: كل توريد أو دفعة مسعّرة يُخلط مع الرف، وكل حركة "بالمتوسط وقتها" (بيع، جرد، هالك) تقول ما كان المتوسط حينها، فيُعاد ضبطه مع ما لا يظهر في الدفتر (سعر كُتب يدويًا، إلغاء).

### 3.2 مخطط الطلبيات الذكي (Smart Order Planner)

```text
1. المبيعات اليومية لكل طبق = مبيعات آخر N يوم (1-90) ÷ N
2. المتوقع = اليومي × (1 + النمو%) لكل يوم قادم (1-60)، أو رقم يحدده المدير لطبق بعينه
3. الحاجة = المتوقع × الوصفات ⇐ مفجّرة لخامات ومصنعات
4. المصنعات من الأعلى للأدنى (TopDown): يُصنع منها فقط
      ما يلزم + حد الطلب − ما على الرف    (لا يُطلب دقيق لعجينة موجودة في الثلاجة)
   وما يُصنع يُفجَّر لمكوناته ويضاف للحاجة
5. لكل خامة مشتراة:
      الموصى به = max(0, الحاجة + حد الطلب − الرصيد)
      المقترح   = ceil(الموصى به ÷ حجم وحدة الشراء)        ← وحدات شراء كاملة
      السعر     = آخر سعر صافٍ (أو المتوسط)، والمورد آخر من باع
6. ورقة الطلب (Excel) مجمّعة بالفئة أو بالمورد
```

### 3.3 النظري مقابل الفعلي (الاستهلاك)

```text
الفعلي  = الرصيد أول الفترة + المشتريات − الهالك المسجّل − الرصيد آخر الفترة
النظري  = ما كان يجب أن تأخذه المبيعات بالوصفات + ما ذهب لمصنعات ما زالت على الرف
الفرق   = الفعلي − النظري ، والنسبة = الفرق ÷ النظري
الحكم   = ضمن السماحية (VarianceTolerancePercent) أو عجز أو زيادة
```

العجز (أحمر): هدر، سرقة، تقديم زائد، أو وصفة مكتوبة أخف من الحقيقة. الزيادة (أزرق): تقديم ناقص، أو مشتريات لم تُسجّل. وتقرير `VarianceService` (الفروقات بين جردين) بنفس المنطق على فترة بين جردين **دوريين**.

### 3.4 ABC وأيام كفاية المخزون (Days on Hand)

```text
الاستخدام = ما أخرج المخزون من الاستعمال: بيع، إنتاج، هالك، إلغاء، عجز جرد
القيمة     = الكمية × التكلفة **وقت الاستخدام** (وما لم يُسعّر: بالمتوسط الآن)
رتّب تنازليًا بالقيمة؛ الحصة التراكمية **قبل** الصف:
   < 75%  ⇐ A  (القلة التي تمثل ثلاثة أرباع القيمة: راقبها يوميًا)
   < 90%  ⇐ B
   غير ذلك ⇐ C
الاستخدام اليومي = الكمية ÷ أيام الفترة (حتى اليوم)
أيام الكفاية    = الرصيد ÷ الاستخدام اليومي     ؛ أقل من 2 ⇐ خطر نفاد قبل التوريد التالي
```

"الحصة قبل الصف" تضمن أن الخامة التي **تعبر** حد 75% تدخل A (فالفئة A دائمًا تغطي 75% على الأقل).

> 📄 **`backend/src/Costing.Infrastructure/Reports/IntelligenceService.cs`** — 967 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Categories;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// Material & demand intelligence (تحليلات الخامات والطلبيات), as a cost accountant reads the stores:
// what the purchase prices did and what that does to the dishes, what to order for the days ahead,
// what was used against what the sales should have taken, and which materials hold the money.
// Every quantity is in the material's purchase unit (kg, L, a carton), every price per it.

public sealed record NamedId(Guid Id, string Name, string? NameAr = null);

// ---- Purchase price variance ----

public enum PriceImpactKind
{
    Dish = 1,
    PrepItem = 2,
}

// What a material's price change does to a dish or a prep item that uses it, its prep items' share
// too: how much of the material goes into a portion of the dish (or a purchase unit of the prep
// item), what that costs more or less now, and against the dish's price, the food cost points; for a
// prep item, its share of what the prep item costs.
public sealed record PriceImpactLine(
    PriceImpactKind Kind, Guid Id, string Name, string? NameAr, string Per, decimal Quantity, decimal CostChange, decimal? Against, decimal? Points);

// One material over the period: the moving average it came in with (Baseline), the latest net price
// paid for it, by how much and what share that moved, what was bought, and the financial impact of
// the change on it: (latest − baseline) × bought. The dishes and prep items it goes into, and who
// sold it last, and the invoice of that latest price.
public sealed record PriceVarianceRow(
    Guid RawMaterialId,
    string? Code,
    string Material,
    Guid CategoryId,
    string? Category,
    string? CategoryAr,
    string PurchaseUnit,
    decimal? BaselineCost,
    decimal? LatestCost,
    decimal? UnitVariance,
    decimal? ChangePercent,
    decimal QuantityPurchased,
    decimal? Impact,
    int Invoices,
    DateOnly? LatestPurchasedOn,
    Guid? LatestSupplierId,
    string? LatestSupplier,
    IReadOnlyList<Guid> SupplierIds,
    IReadOnlyList<PriceImpactLine> Affected,
    Guid? LatestInvoiceId = null);

public sealed record PriceVarianceReport(
    DateOnly From,
    DateOnly To,
    decimal TotalImpact,
    decimal Increases,
    decimal Decreases,
    int Rising,
    int Falling,
    int AffectedDishes,
    string? LargestRise,
    decimal? LargestRisePercent,
    IReadOnlyList<PriceVarianceRow> Rows,
    IReadOnlyList<NamedId> Categories,
    IReadOnlyList<NamedId> Suppliers);

// ---- The order planner ----

// What the manager expects a dish (a size, when it has sizes) to sell a day.
public sealed record DishExpectation(int MenuItemId, int? VariantId, decimal ExpectedDaily);

// The last LookbackDays' sales a day, for CoverageDays ahead, grown by GrowthPercent (a weekend, a
// holiday); a dish expected otherwise is as Dishes say.
public sealed record OrderPlanRequest(int LookbackDays = 14, int CoverageDays = 7, decimal GrowthPercent = 0, IReadOnlyList<DishExpectation>? Dishes = null);

public sealed record PlannedDish(
    int MenuItemId, int? VariantId, string Code, string Name, string? NameAr, bool HasRecipe, decimal AverageDaily, decimal ExpectedDaily, bool Expected);

// One bought material: what is on the shelf, what the past days used a day, what the days ahead need
// (the prep items on hand netted first), its reorder level, what to order (Recommended, the need
// less the shelf; Suggested, rounded up to whole purchase units), at the latest net price paid, from
// who sold it last.
public sealed record OrderPlanLine(
    Guid RawMaterialId,
    string? Code,
    string Material,
    Guid CategoryId,
    string? Category,
    string? CategoryAr,
    string PurchaseUnit,
    decimal OnHand,
    decimal AverageDailyUsage,
    decimal ExpectedUsage,
    decimal ReorderLevel,
    decimal Recommended,
    decimal Suggested,
    decimal? UnitPrice,
    decimal? EstimatedCost,
    Guid? SupplierId,
    string? Supplier,
    bool BelowReorder);

public sealed record OrderPlan(
    DateOnly LookbackFrom,
    DateOnly LookbackTo,
    int LookbackDays,
    int CoverageDays,
    decimal GrowthPercent,
    IReadOnlyList<PlannedDish> Dishes,
    IReadOnlyList<OrderPlanLine> Lines,
    int ToOrder,
    decimal EstimatedTotal,
    int BelowReorder,
    IReadOnlyList<string> NoPrice);

public enum OrderSheetGrouping
{
    Category = 1,
    // By the supplier who sold each last.
    Supplier = 2,
    // By the supplier whose last net price for it is the lowest (الأقل سعراً), at that price.
    CheapestSupplier = 3,
}

// ---- Vendor price comparison (مقارنة أسعار الموردين) ----

// One supplier's prices for one material over the period, per purchase unit and net of every
// discount (the line's and its share of the invoice's): the last paid and when, the lowest, the
// highest, the average weighted by quantity, and what was bought. BestPrice: the lowest last price.
public sealed record VendorPrice(
    Guid? SupplierId,
    string Supplier,
    decimal? LastPrice,
    DateOnly LastDate,
    decimal? LowestPrice,
    decimal? HighestPrice,
    decimal? AveragePrice,
    decimal Quantity,
    int Purchases,
    bool BestPrice);

// A material bought in the period, its suppliers cheapest first. Spread: how far the dearest last
// price is above the cheapest, as a percentage; none with a single supplier.
public sealed record VendorPriceRow(
    Guid RawMaterialId,
    string? Code,
    string Material,
    Guid CategoryId,
    string? Category,
    string? CategoryAr,
    string PurchaseUnit,
    IReadOnlyList<VendorPrice> Suppliers,
    decimal? SpreadPercent);

public sealed record VendorPriceReport(DateOnly From, DateOnly To, int Materials, int WithChoice, IReadOnlyList<VendorPriceRow> Rows);

// The order as approved: each material's quantity in its purchase unit.
public sealed record OrderSheetLine(Guid RawMaterialId, decimal Quantity);

public sealed record OrderSheetRequest(IReadOnlyList<OrderSheetLine> Lines, OrderSheetGrouping GroupBy = OrderSheetGrouping.Category, int? CoverageDays = null);

// The approved order, for the sheet: each line with its unit price and cost, and the group it is under.
public sealed record OrderSheetRow(string Group, string? Code, string Material, string PurchaseUnit, decimal Quantity, decimal? UnitPrice, decimal? Cost, string? Other);

public sealed record OrderSheet(OrderSheetGrouping GroupBy, int? CoverageDays, DateOnly Today, IReadOnlyList<OrderSheetRow> Rows, decimal Total);

// ---- Theoretical against actual consumption ----

// One bought material over the period. Actual usage: opening + purchases − logged waste − staff
// meals, hospitality and tastings (StaffMeals: taken on purpose, never a loss) − closing,
// the book's stock either side. Theoretical: what the sales should have taken by the recipes, down
// through the prep items, and what is held in the prep items' stock made from it (HeldInPrep: made
// and not sold yet, or below zero, sold from what was made before). Unexplained: actual −
// theoretical, valued at the average cost now. A prep item's waste counts as its ingredients'.
public sealed record ConsumptionRow(
    Guid RawMaterialId,
    string? Code,
    string Material,
    Guid CategoryId,
    string? Category,
    string? CategoryAr,
    string PurchaseUnit,
    decimal Opening,
    decimal Purchases,
    decimal Waste,
    decimal Closing,
    decimal ActualUsage,
    decimal TheoreticalUsage,
    decimal HeldInPrep,
    decimal UnexplainedQuantity,
    decimal? UnexplainedPercent,
    decimal? UnitCost,
    decimal? VarianceCost,
    VarianceEvaluation Evaluation,
    decimal StaffMeals = 0);

// WasteValue and StaffMealsValue: the logged spoilage and the staff meals, hospitality and tastings,
// at the average cost now, each apart from the unexplained.
public sealed record ConsumptionReport(
    DateOnly From,
    DateOnly To,
    decimal TolerancePercent,
    decimal TheoreticalValue,
    decimal ActualValue,
    decimal UnexplainedValue,
    int HighLoss,
    IReadOnlyList<ConsumptionRow> Rows,
    IReadOnlyList<SoldWithoutStock> SoldWithoutRecipe,
    decimal WasteValue = 0,
    decimal StaffMealsValue = 0);

// ---- ABC and days on hand ----

public enum AbcClass
{
    A = 1,
    B = 2,
    C = 3,
}

// One bought material: what the period used of it (sold, made into prep items, wasted, short at a
// count) and its worth at the cost then, its share and the running share down the list, its class;
// what is on the shelf and its worth, what it uses a day and so how many days it lasts.
public sealed record AbcRow(
    Guid RawMaterialId,
    string? Code,
    string Material,
    Guid CategoryId,
    string? Category,
    string? CategoryAr,
    string PurchaseUnit,
    decimal Consumption,
    decimal ConsumptionValue,
    decimal SharePercent,
    decimal CumulativePercent,
    AbcClass Class,
    decimal OnHand,
    decimal? StockValue,
    decimal AverageDaily,
    decimal? DaysOnHand,
    bool StockoutRisk,
    bool DeadStock);

public sealed record AbcClassSummary(AbcClass Class, int Materials, decimal Value, decimal SharePercent);

public sealed record AbcReport(
    DateOnly From,
    DateOnly To,
    int Days,
    decimal ConsumptionValue,
    IReadOnlyList<AbcClassSummary> Classes,
    int StockoutRisks,
    int DeadStock,
    decimal DeadStockValue,
    decimal StockValue,
    IReadOnlyList<AbcRow> Rows);

// ---- Spot count presets ----

// A spot count's ready list (جرد يومي سريع): the materials in it, by id alone (no figures), so a
// storekeeper starts one as readily as a manager.
public sealed record CountPreset(string Key, string Name, string NameAr, IReadOnlyList<Guid> MaterialIds);

public sealed record CountCategoryPreset(Guid CategoryId, string Name, string? NameAr, IReadOnlyList<Guid> MaterialIds);

// Critical: the daily critical items starred. ClassA: class A of the last 30 days (ABC). HighVariance:
// what ran over its recipes in them (theoretical against actual, unfavourable) or came up short at the
// last periodic count by more than the tolerance. And each category's materials.
public sealed record CountPresets(DateOnly From, DateOnly To, decimal TolerancePercent, IReadOnlyList<CountPreset> Presets, IReadOnlyList<CountCategoryPreset> Categories);

public sealed class IntelligenceService(CostingDbContext db, IBusinessCalendar clock, SalesLedger ledger)
{
    // The days a preset looks back over.
    public const int PresetDays = 30;
    // Class A: what the materials up to three quarters of the value are; B, the next 15%.
    public const decimal ClassALimit = 75;
    public const decimal ClassBLimit = 90;

    // Fewer days on hand than this: it runs out before the next delivery is likely in.
    public const decimal StockoutDays = 2;

    // What took stock out of use: sold, made into prep items, wasted, short at a count.
    private static readonly StockMovementReason[] Uses =
    [
        StockMovementReason.Sale, StockMovementReason.ProductionInput, StockMovementReason.Waste, StockMovementReason.Spoilage,
        StockMovementReason.VoidReturn, StockMovementReason.CountAdjustment, StockMovementReason.StaffMeal, StockMovementReason.Hospitality,
        StockMovementReason.RecipeTasting,
    ];

    // Waste logged: spoilage, and dishes voided after the kitchen made them, less what refunds put back.
    private static readonly StockMovementReason[] WasteReasons = [StockMovementReason.Waste, StockMovementReason.Spoilage, StockMovementReason.VoidReturn];

    // A movement priced at the average cost when it was made: what the average was then.
    private static readonly StockMovementReason[] AtAverage =
    [
        StockMovementReason.Sale, StockMovementReason.Waste, StockMovementReason.VoidReturn, StockMovementReason.Spoilage,
        StockMovementReason.ProductionInput, StockMovementReason.CountAdjustment, StockMovementReason.OpeningStock,
        StockMovementReason.StaffMeal, StockMovementReason.Hospitality, StockMovementReason.RecipeTasting,
    ];

    public DateOnly Today => clock.BusinessDateOf(DateTime.UtcNow);

    // ---- Spot count presets ----

    public async Task<CountPresets> GetCountPresetsAsync(CancellationToken cancellationToken)
    {
        var (to, from) = (Today, Today.AddDays(-(PresetDays - 1)));
        var materials = await db.RawMaterials.AsNoTracking().Where(m => m.ArchivedAtUtc == null).ToListAsync(cancellationToken);
        var active = materials.Select(m => m.Id).ToHashSet();
        var tolerance = (await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken))?.VarianceTolerancePercent
            ?? CostingSettings.DefaultVarianceTolerance;

        var critical = materials.Where(m => m.IsSpotCheckItem).OrderBy(m => m.Name).Select(m => m.Id).ToList();
        var classA = (await GetAbcAsync(from, to, cancellationToken)).Rows
            .Where(r => r.Class == AbcClass.A && r.ConsumptionValue > 0 && active.Contains(r.RawMaterialId))
            .Select(r => r.RawMaterialId)
            .ToList();

        // Over its recipes in the last days, or short at the last periodic count beyond the tolerance.
        var overRecipes = (await GetConsumptionAsync(from, to, cancellationToken)).Rows
            .Where(r => r.Evaluation == VarianceEvaluation.Unfavourable)
            .Select(r => r.RawMaterialId);
        var lastCount = await db.StockCounts.AsNoTracking().Include(c => c.Lines)
            .Where(c => c.Status == Domain.StockCounts.StockCountStatus.Posted && c.Kind == Domain.StockCounts.StockCountKind.Periodic)
            .OrderByDescending(c => c.PostedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
        var shortAtCount = (lastCount?.Lines ?? [])
            .Where(l => l.BookQuantity is > 0 and var book && (l.CountedQuantity - book) / book * 100 < -tolerance)
            .Select(l => l.RawMaterialId);
        var highVariance = overRecipes.Concat(shortAtCount).Where(active.Contains).Distinct().ToList();

        var categories = await db.PurchaseCategories.AsNoTracking().ToListAsync(cancellationToken);
        var byCategory = materials.ToLookup(m => m.CategoryId);
        return new CountPresets(
            from, to, tolerance,
            [
                new CountPreset("critical", "Daily critical items", "أصناف الجرد اليومي المحددة", critical),
                new CountPreset("classA", "Top class-A materials", "أصناف الفئة A الأعلى قيمة", classA),
                new CountPreset("highVariance", "High-variance materials", "الأصناف الأكثر انحرافًا", highVariance),
            ],
            categories
                .Where(c => byCategory[c.Id].Any())
                .OrderBy(c => c.Name, StringComparer.CurrentCultureIgnoreCase)
                .Select(c => new CountCategoryPreset(c.Id, c.Name, c.NameAr, byCategory[c.Id].OrderBy(m => m.Name).Select(m => m.Id).ToList()))
                .ToList());
    }

    // ---- Purchase price variance and recipe impact ----

    public async Task<PriceVarianceReport> GetPriceVarianceAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var (fromUtc, toUtc) = Period(from, to);
        var catalog = await CatalogAsync(cancellationToken);
        var bought = (await PurchasesAsync(cancellationToken))
            .Where(p => p.Date >= from && p.Date <= to)
            .ToLookup(p => p.RawMaterialId);
        var ids = bought.Select(g => g.Key).Where(catalog.Materials.ContainsKey).ToList();

        // The moving average each came in with, from its ledger before the period.
        var history = (await db.StockMovements.AsNoTracking()
                .Where(m => m.OccurredAtUtc < fromUtc && ids.Contains(m.RawMaterialId))
                .OrderBy(m => m.OccurredAtUtc)
                .ToListAsync(cancellationToken))
            .ToLookup(m => m.RawMaterialId);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);

        var rows = new List<PriceVarianceRow>();
        foreach (var id in ids)
        {
            var material = catalog.Materials[id];
            var lines = bought[id].OrderBy(p => p.Date).ThenBy(p => p.PostedAtUtc).ToList();
            var priced = lines.Where(p => p.UnitCost is not null).ToList();
            var latest = priced.LastOrDefault();
            var baseline = AverageBefore(history[id]) ?? priced.FirstOrDefault()?.UnitCost;
            var change = latest?.UnitCost - baseline;
            var size = material.PurchaseUnitSize;
            var quantity = lines.Sum(p => p.Quantity);
            rows.Add(new PriceVarianceRow(
                id, material.Code, material.Name, material.CategoryId, catalog.CategoryName(material.CategoryId), catalog.CategoryAr(material.CategoryId),
                material.PurchaseUnit, Money(baseline * size), Money(latest?.UnitCost * size), Money(change * size),
                baseline > 0 && change is { } moved ? Percent(moved / baseline.Value) : null,
                Quantity(quantity / size), Money(change * quantity), lines.Select(p => p.InvoiceId).Distinct().Count(),
                latest?.Date, latest?.SupplierId, latest?.SupplierId is { } s ? suppliers.GetValueOrDefault(s) : null,
                lines.Where(p => p.SupplierId is not null).Select(p => p.SupplierId!.Value).Distinct().ToList(),
                change is { } delta && delta != 0 ? Affected(catalog, material, delta) : [], latest?.InvoiceId));
        }

        rows = rows.OrderByDescending(r => Math.Abs(r.Impact ?? 0)).ThenBy(r => r.Material).ToList();
        var rising = rows.Where(r => r.UnitVariance > 0).ToList();
        var largest = rising.Where(r => r.ChangePercent is not null).MaxBy(r => r.ChangePercent);
        return new PriceVarianceReport(
            from, to, Money(rows.Sum(r => r.Impact ?? 0)), Money(rows.Where(r => r.Impact > 0).Sum(r => r.Impact!.Value)),
            Money(rows.Where(r => r.Impact < 0).Sum(r => r.Impact!.Value)), rising.Count, rows.Count(r => r.UnitVariance < 0),
            rising.SelectMany(r => r.Affected).Where(a => a.Kind == PriceImpactKind.Dish).Select(a => a.Id).Distinct().Count(),
            largest?.Material, largest?.ChangePercent, rows,
            rows.GroupBy(r => r.CategoryId).Select(g => new NamedId(g.Key, g.First().Category ?? "Uncategorized", g.First().CategoryAr))
                .OrderBy(c => c.Name).ToList(),
            rows.SelectMany(r => r.SupplierIds).Distinct().Where(suppliers.ContainsKey).Select(s => new NamedId(s, suppliers[s]))
                .OrderBy(s => s.Name).ToList());
    }

    // The dishes and prep items a material goes into, directly or inside a prep item, and what a
    // change of `change` a unit (a gram, millilitre or piece) does to each, the largest first.
    private static IReadOnlyList<PriceImpactLine> Affected(Catalog catalog, RawMaterial material, decimal change)
    {
        var lines = new List<PriceImpactLine>();
        foreach (var prep in catalog.Materials.Values.Where(m => m.IsPrepItem && !m.IsArchived && catalog.Explosion.IsMade(m.Id)))
        {
            var perUnit = catalog.Explosion.PerUnit(prep.Id).GetValueOrDefault(material.Id);
            if (perUnit == 0)
                continue;
            var perPurchaseUnit = perUnit * prep.PurchaseUnitSize;
            var cost = catalog.Costs.Of(prep.Id).PerUnit * prep.PurchaseUnitSize;
            var moved = perPurchaseUnit * change;
            lines.Add(new PriceImpactLine(
                PriceImpactKind.PrepItem, prep.Id, prep.Name, null, prep.PurchaseUnit, Quantity(perPurchaseUnit / material.PurchaseUnitSize), Money(moved),
                Money(cost), cost > 0 ? Percent(moved / cost.Value) : null));
        }

        foreach (var recipe in catalog.Recipes.Where(r => !r.IsDeleted && r.Ingredients.Count > 0))
        {
            var perPortion = recipe.Ingredients.Sum(i => catalog.Explosion.PerUnit(i.RawMaterialId).GetValueOrDefault(material.Id) * i.AsPurchasedQuantity)
                / recipe.Portions;
            if (perPortion == 0)
                continue;
            var sold = recipe.Target is { } target ? catalog.Targets.GetValueOrDefault(target) : null;
            var price = sold is not null ? sold.Price : recipe.PlannedPrice;
            var moved = perPortion * change;
            lines.Add(new PriceImpactLine(
                PriceImpactKind.Dish, recipe.Id, sold?.Name ?? recipe.Name ?? "A recipe", sold?.NameAr, "portion",
                Quantity(perPortion / material.PurchaseUnitSize), Money(moved), price, price > 0 ? Percent(moved / price.Value) : null));
        }

        return lines.OrderByDescending(l => Math.Abs(l.CostChange)).ThenBy(l => l.Name).ToList();
    }

    // The average cost a material had at the end of these movements, as its ledger tells it: each
    // priced delivery or batch averaged in with what was on the shelf, as the material does it;
    // each movement made at the average then (a sale, a count, waste) saying what it was, which also
    // brings back in step anything the ledger does not show (a price typed in, a void). Null with
    // nothing to go by.
    internal static decimal? AverageBefore(IEnumerable<StockMovement> movements)
    {
        decimal? average = null;
        decimal onHand = 0;
        foreach (var m in movements)
        {
            if (m.ReversalOf is null && m.Quantity > 0 && m.UnitCost is { } cost
                && m.Reason is StockMovementReason.Purchase or StockMovementReason.ProductionOutput)
            {
                var onShelf = Math.Max(onHand, 0);
                average = average is { } before && onShelf > 0 ? (onShelf * before + m.Quantity * cost) / (onShelf + m.Quantity) : cost;
            }
            else if (m.ReversalOf is null && m.UnitCost is { } at && AtAverage.Contains(m.Reason))
                average = at;
            onHand += m.Quantity;
        }

        return average;
    }

    // ---- The order planner ----

    public async Task<OrderPlan> PlanOrderAsync(OrderPlanRequest request, CancellationToken cancellationToken)
    {
        if (request.LookbackDays is < 1 or > 90)
            throw new DomainException("Look back 1 to 90 days. · من 1 إلى 90 يومًا.");
        if (request.CoverageDays is < 1 or > 60)
            throw new DomainException("Order for 1 to 60 days ahead. · من 1 إلى 60 يومًا.");
        if (request.GrowthPercent is < -90 or > 500)
            throw new DomainException("Grow the sales by −90% to +500%. · نسبة النمو من −90% إلى +500%.");
        if (request.Dishes?.Any(d => d.ExpectedDaily < 0) == true)
            throw new DomainException("A dish is expected to sell zero or more a day. · المبيعات المتوقعة صفر أو أكثر.");

        var catalog = await CatalogAsync(cancellationToken);
        var today = Today;
        var (lookFrom, lookTo) = (today.AddDays(-request.LookbackDays), today.AddDays(-1));
        var sold = await SoldAsync(lookFrom, lookTo, cancellationToken);
        decimal days = request.LookbackDays;

        // Each dish the menu sells by a recipe, or sold in the days looked back: what it sold a day,
        // and what it is expected to.
        var expected = (request.Dishes ?? []).GroupBy(d => (d.MenuItemId, d.VariantId)).ToDictionary(g => g.Key, g => g.Last().ExpectedDaily);
        var byDish = sold.GroupBy(s => (s.Key.MenuItemId, s.Key.VariantId)).ToDictionary(g => g.Key, g => g.ToList());
        var dishes = catalog.Targets.Where(t => t.Key.Kind == RecipeTargetKind.MenuItem && t.Value.Sold)
            .Select(t => (MenuItemId: t.Key.CatalogItemId, t.Key.VariantId))
            .Where(key => catalog.RecipeFor(key.MenuItemId, key.VariantId) is not null)
            .Concat(byDish.Keys)
            .Distinct()
            .Select(key =>
            {
                var target = catalog.Targets.GetValueOrDefault(key.VariantId is { } v
                    ? RecipeTarget.ForVariant(key.MenuItemId, v)
                    : RecipeTarget.ForMenuItem(key.MenuItemId));
                var average = byDish.GetValueOrDefault(key)?.Sum(s => s.Quantity) / days ?? 0;
                var overridden = expected.TryGetValue(key, out var set);
                var name = target?.Name ?? byDish.GetValueOrDefault(key)?.First().Name ?? $"Item {key.MenuItemId}";
                return new PlannedDish(
                    key.MenuItemId, key.VariantId, ItemCode(key.MenuItemId, key.VariantId), name, target?.NameAr,
                    catalog.RecipeFor(key.MenuItemId, key.VariantId) is not null, Quantity(average),
                    Quantity(overridden ? set : average * (1 + request.GrowthPercent / 100)), overridden);
            })
            .OrderByDescending(d => d.AverageDaily).ThenBy(d => d.Code)
            .ToList();

        // What a day took in the days looked back, down to bought materials; and what the days
        // ahead need, each sold line's share of its dish's expected sales, prep items still whole.
        var pastDay = new Dictionary<Guid, decimal>();
        var ahead = new Dictionary<Guid, decimal>();
        foreach (var dish in dishes)
        {
            var soldLines = byDish.GetValueOrDefault((dish.MenuItemId, dish.VariantId)) ?? [];
            var total = soldLines.Sum(s => s.Quantity);
            // As expected, not as shown: the shown figure is rounded.
            var daily = expected.TryGetValue((dish.MenuItemId, dish.VariantId), out var set) ? set : total / days * (1 + request.GrowthPercent / 100);
            List<(SaleKey Key, decimal Share, decimal Past)> keys = total > 0
                ? soldLines.Select(s => (s.Key, s.Quantity / total, s.Quantity / days)).ToList()
                : [(new SaleKey(dish.MenuItemId, dish.VariantId, ""), 1m, 0m)];
            foreach (var (key, share, past) in keys)
            {
                var per = catalog.Requirements(key);
                foreach (var (id, quantity) in catalog.Explosion.Explode(per))
                    pastDay[id] = pastDay.GetValueOrDefault(id) + quantity * past;
                foreach (var (id, quantity) in per)
                    ahead[id] = ahead.GetValueOrDefault(id) + quantity * share * daily * request.CoverageDays;
            }
        }

        // The prep items first, each before those it is made with: what is on hand of one is used
        // before it is made again, and only what has to be made is broken into its ingredients.
        foreach (var prepId in catalog.Explosion.TopDown())
        {
            if (catalog.Materials.GetValueOrDefault(prepId) is not { } prep)
                continue;
            var make = ahead.GetValueOrDefault(prepId) + prep.ReorderLevel - Math.Max(prep.QuantityOnHand, 0);
            if (make <= 0)
                continue;
            foreach (var (id, quantity) in catalog.Explosion.Ingredients(prepId, make))
                ahead[id] = ahead.GetValueOrDefault(id) + quantity;
        }

        var prices = await LatestPricesAsync(cancellationToken);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);
        var lines = new List<OrderPlanLine>();
        foreach (var material in catalog.Materials.Values.Where(m => !m.IsPrepItem && !m.IsArchived))
        {
            var need = ahead.GetValueOrDefault(material.Id);
            var usage = pastDay.GetValueOrDefault(material.Id);
            var recommended = Math.Max(0, need + material.ReorderLevel - material.QuantityOnHand);
            if (need == 0 && usage == 0 && recommended == 0)
                continue;
            var size = material.PurchaseUnitSize;
            var suggested = Math.Ceiling(Math.Round(recommended / size, 6));
            var last = prices.GetValueOrDefault(material.Id);
            var price = last?.UnitCost * size ?? material.CostPerPurchaseUnit;
            lines.Add(new OrderPlanLine(
                material.Id, material.Code, material.Name, material.CategoryId, catalog.CategoryName(material.CategoryId), catalog.CategoryAr(material.CategoryId),
                material.PurchaseUnit, Quantity(material.QuantityOnHand / size), Quantity(usage / size), Quantity(need / size),
                Quantity(material.ReorderLevel / size), Quantity(recommended / size), suggested, Money(price), Money(suggested * price),
                last?.SupplierId, last?.SupplierId is { } s ? suppliers.GetValueOrDefault(s) : null, material.NeedsReorder));
        }

        lines = lines.OrderBy(l => l.Category).ThenBy(l => l.Material).ToList();
        var toOrder = lines.Where(l => l.Suggested > 0).ToList();
        return new OrderPlan(
            lookFrom, lookTo, request.LookbackDays, request.CoverageDays, request.GrowthPercent, dishes, lines, toOrder.Count,
            Money(toOrder.Sum(l => l.EstimatedCost ?? 0)), lines.Count(l => l.BelowReorder),
            toOrder.Where(l => l.UnitPrice is null).Select(l => l.Material).ToList());
    }

    // The order as approved, for its sheet: each material's line at the latest net price, under its
    // category or the supplier who sold it last.
    public async Task<OrderSheet> OrderSheetAsync(OrderSheetRequest request, CancellationToken cancellationToken)
    {
        if (request.Lines.Any(l => l.Quantity < 0))
            throw new DomainException("Order zero or more of each. · الكمية صفر أو أكثر.");
        var ids = request.Lines.Where(l => l.Quantity > 0).Select(l => l.RawMaterialId).Distinct().ToList();
        if (ids.Count == 0)
            throw new DomainException("Approve something to order first. · اعتمد كمية لصنف واحد على الأقل.");
        var materials = await db.RawMaterials.AsNoTracking().Where(m => ids.Contains(m.Id)).ToDictionaryAsync(m => m.Id, cancellationToken);
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);
        var prices = await LatestPricesAsync(cancellationToken);
        var cheapest = request.GroupBy == OrderSheetGrouping.CheapestSupplier
            ? await CheapestPricesAsync(Today.AddDays(-CheapestLookbackDays), Today, cancellationToken)
            : new Dictionary<Guid, Bought>();

        var rows = request.Lines.Where(l => l.Quantity > 0 && materials.ContainsKey(l.RawMaterialId))
            .GroupBy(l => l.RawMaterialId)
            .Select(g =>
            {
                var material = materials[g.Key];
                var last = request.GroupBy == OrderSheetGrouping.CheapestSupplier
                    ? cheapest.GetValueOrDefault(material.Id) ?? prices.GetValueOrDefault(material.Id)
                    : prices.GetValueOrDefault(material.Id);
                var price = Money(last?.UnitCost * material.PurchaseUnitSize ?? material.CostPerPurchaseUnit);
                var quantity = g.Sum(l => l.Quantity);
                var category = categories.GetValueOrDefault(material.CategoryId) ?? "Uncategorized";
                var supplier = last?.SupplierId is { } s ? suppliers.GetValueOrDefault(s) : null;
                return request.GroupBy is OrderSheetGrouping.Supplier or OrderSheetGrouping.CheapestSupplier
                    ? new OrderSheetRow(supplier ?? "No supplier yet", material.Code, material.Name, material.PurchaseUnit, quantity, price, Money(quantity * price), category)
                    : new OrderSheetRow(category, material.Code, material.Name, material.PurchaseUnit, quantity, price, Money(quantity * price), supplier);
            })
            .OrderBy(r => r.Group).ThenBy(r => r.Material)
            .ToList();
        return new OrderSheet(request.GroupBy, request.CoverageDays, Today, rows, Money(rows.Sum(r => r.Cost ?? 0)));
    }

    // ---- Theoretical against actual consumption ----

    public async Task<ConsumptionReport> GetConsumptionAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var (fromUtc, toUtc) = Period(from, to);
        var catalog = await CatalogAsync(cancellationToken);
        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var tolerance = settings.VarianceTolerancePercent;
        var shared = (await db.SharedCosts.AsNoTracking().Where(c => c.RawMaterialId != null).Select(c => c.RawMaterialId!.Value)
            .ToListAsync(cancellationToken)).ToHashSet();

        var stock = await StockAsync(fromUtc, toUtc, cancellationToken);

        // What the sales should have taken, by the recipes as they stand.
        var sold = await SoldAsync(from, to, cancellationToken);
        var theoretical = new Dictionary<Guid, decimal>();
        var withoutRecipe = new List<SoldWithoutStock>();
        foreach (var line in sold)
        {
            var per = catalog.Requirements(line.Key);
            if (per.Count == 0)
            {
                withoutRecipe.Add(new SoldWithoutStock(ItemCode(line.Key.MenuItemId, line.Key.VariantId), line.Name, (int)line.Quantity));
                continue;
            }
            foreach (var (id, quantity) in catalog.Explosion.Explode(per))
                theoretical[id] = theoretical.GetValueOrDefault(id) + quantity * line.Quantity;
        }

        // The prep items' stock change and their waste, in what they are made of.
        var prepItems = catalog.Materials.Values.Where(m => m.IsPrepItem && catalog.Explosion.IsMade(m.Id)).ToList();
        var held = catalog.Explosion.Explode(prepItems.Select(p => KeyValuePair.Create(p.Id, stock.Closing(p.Id) - stock.Opening(p.Id))));
        var prepWaste = catalog.Explosion.Explode(prepItems.Select(p => KeyValuePair.Create(p.Id, stock.Wasted(p.Id))));
        var prepStaff = catalog.Explosion.Explode(prepItems.Select(p => KeyValuePair.Create(p.Id, stock.Staff(p.Id))));

        var rows = new List<ConsumptionRow>();
        foreach (var material in catalog.Materials.Values.Where(m => !m.IsPrepItem))
        {
            var id = material.Id;
            var (opening, purchases, closing) = (stock.Opening(id), stock.Moved(id, StockMovementReason.Purchase), stock.Closing(id));
            var waste = stock.Wasted(id) + prepWaste.GetValueOrDefault(id);
            var staff = stock.Staff(id) + prepStaff.GetValueOrDefault(id);
            var inPrep = held.GetValueOrDefault(id);
            var expected = theoretical.GetValueOrDefault(id) + inPrep;
            if (opening == 0 && purchases == 0 && waste == 0 && staff == 0 && closing == 0 && expected == 0)
                continue;
            var actual = opening + purchases - waste - staff - closing;
            var unexplained = actual - expected;
            decimal? percent = expected > 0 ? Percent(unexplained / expected) : null;
            var evaluation = shared.Contains(id) && expected == 0 ? VarianceEvaluation.SharedCost
                : percent is { } p
                ? p > tolerance ? VarianceEvaluation.Unfavourable : p < -tolerance ? VarianceEvaluation.Favourable : VarianceEvaluation.WithinLimit
                : unexplained > 0 ? VarianceEvaluation.Unfavourable : unexplained < 0 ? VarianceEvaluation.Favourable : VarianceEvaluation.WithinLimit;
            var size = material.PurchaseUnitSize;
            rows.Add(new ConsumptionRow(
                id, material.Code, material.Name, material.CategoryId, catalog.CategoryName(material.CategoryId), catalog.CategoryAr(material.CategoryId),
                material.PurchaseUnit, Quantity(opening / size), Quantity(purchases / size), Quantity(waste / size), Quantity(closing / size),
                Quantity(actual / size), Quantity(expected / size), Quantity(inPrep / size), Quantity(unexplained / size), percent,
                Money(material.CostPerPurchaseUnit), Money(unexplained * material.AverageCost), evaluation, Quantity(staff / size)));
        }

        rows = rows.OrderBy(r => r.Evaluation == VarianceEvaluation.SharedCost).ThenByDescending(r => r.VarianceCost ?? 0).ThenBy(r => r.Material).ToList();
        var measured = rows.Where(r => r.Evaluation != VarianceEvaluation.SharedCost).ToList();
        decimal Worth(Func<ConsumptionRow, decimal> quantity) => Money(measured.Sum(r => quantity(r) * (r.UnitCost ?? 0)));
        return new ConsumptionReport(
            from, to, tolerance, Worth(r => r.TheoreticalUsage), Worth(r => r.ActualUsage), Money(measured.Sum(r => r.VarianceCost ?? 0)),
            measured.Count(r => r.Evaluation == VarianceEvaluation.Unfavourable), rows,
            withoutRecipe.GroupBy(w => (w.ItemCode, w.MenuItem)).Select(g => new SoldWithoutStock(g.Key.ItemCode, g.Key.MenuItem, g.Sum(w => w.Quantity)))
                .OrderByDescending(w => w.Quantity).ToList(),
            Worth(r => r.Waste), Worth(r => r.StaffMeals));
    }

    // ---- ABC classification and days on hand ----

    public async Task<AbcReport> GetAbcAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var (fromUtc, toUtc) = Period(from, to);
        var today = Today;
        var days = Math.Max(1, (to < today ? to : today).DayNumber - from.DayNumber + 1);
        var materials = await db.RawMaterials.AsNoTracking().Where(m => m.Kind != MaterialKind.Prep && m.ArchivedAtUtc == null)
            .ToDictionaryAsync(m => m.Id, cancellationToken);
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, cancellationToken);
        var used = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc >= fromUtc && m.OccurredAtUtc < toUtc && Uses.Contains(m.Reason))
            .GroupBy(m => m.RawMaterialId)
            .Select(g => new { RawMaterialId = g.Key, Quantity = -g.Sum(m => m.Quantity), Value = -g.Sum(m => m.Quantity * m.UnitCost), Unpriced = -g.Where(m => m.UnitCost == null).Sum(m => m.Quantity) })
            .ToDictionaryAsync(u => u.RawMaterialId, cancellationToken);

        var measured = materials.Values.Select(m =>
            {
                var use = used.GetValueOrDefault(m.Id);
                var quantity = Math.Max(use?.Quantity ?? 0, 0);
                // At the cost when it was used; what had no price then, at the average now.
                var value = quantity > 0 ? Math.Max((use!.Value ?? 0) + use.Unpriced * (m.AverageCost ?? 0), 0) : 0;
                return (Material: m, Quantity: quantity, Value: value);
            })
            .OrderByDescending(x => x.Value).ThenBy(x => x.Material.Name)
            .ToList();
        var total = measured.Sum(x => x.Value);

        var rows = new List<AbcRow>();
        decimal running = 0;
        foreach (var (material, quantity, value) in measured)
        {
            var before = total > 0 ? running * 100 / total : 100;
            running += value;
            var abc = value <= 0 ? AbcClass.C : before < ClassALimit ? AbcClass.A : before < ClassBLimit ? AbcClass.B : AbcClass.C;
            var size = material.PurchaseUnitSize;
            var daily = quantity / days;
            decimal? onHandDays = daily > 0 ? Math.Round(Math.Max(material.QuantityOnHand, 0) / daily, 1, MidpointRounding.AwayFromZero) : null;
            var category = categories.GetValueOrDefault(material.CategoryId);
            rows.Add(new AbcRow(
                material.Id, material.Code, material.Name, material.CategoryId, category?.Name, category?.NameAr, material.PurchaseUnit,
                Quantity(quantity / size), Money(value), total > 0 ? Percent(value / total) : 0, total > 0 ? Percent(running / total) : 0, abc,
                Quantity(material.QuantityOnHand / size), Money(Math.Max(material.QuantityOnHand, 0) * material.AverageCost),
                Quantity(daily / size), onHandDays, onHandDays < StockoutDays, quantity == 0 && material.QuantityOnHand > 0));
        }

        var dead = rows.Where(r => r.DeadStock).ToList();
        return new AbcReport(
            from, to, days, Money(total),
            Enum.GetValues<AbcClass>().Select(c =>
            {
                var of = rows.Where(r => r.Class == c).ToList();
                var worth = of.Sum(r => r.ConsumptionValue);
                return new AbcClassSummary(c, of.Count, Money(worth), total > 0 ? Percent(worth / total) : 0);
            }).ToList(),
            rows.Count(r => r.StockoutRisk), dead.Count, Money(dead.Sum(r => r.StockValue ?? 0)), Money(rows.Sum(r => r.StockValue ?? 0)), rows);
    }

    // ---- What the reports share ----

    // A sold line as the recipes see it: a dish, its size, its add-ons.
    private sealed record SaleKey(int MenuItemId, int? VariantId, string AddOns)
    {
        public SoldItem Item(int quantity) =>
            new(MenuItemId, VariantId, AddOns.Length == 0 ? [] : AddOns.Split(',').Select(int.Parse).ToList(), quantity);
    }

    private sealed record Sold(SaleKey Key, string Name, decimal Quantity);

    // A dish or add-on the recipes sell by: its name, and its price (none for one priced by its add-ons).
    private sealed record Target(string Name, string? NameAr, decimal? Price, bool Sold);

    // What a report reads the recipes and materials from, loaded once.
    private sealed class Catalog(
        IReadOnlyDictionary<Guid, RawMaterial> materials,
        IReadOnlyDictionary<Guid, PurchaseCategory> categories,
        IReadOnlyList<Recipe> recipes,
        IReadOnlyList<PrepRecipe> prepRecipes,
        IReadOnlyDictionary<RecipeTarget, Target> targets,
        // What each combo is made of, by its menu number: a combo sold takes its dishes' stock.
        IReadOnlyDictionary<int, IReadOnlyList<ComboPart>> combos)
    {
        private readonly Dictionary<SaleKey, IReadOnlyDictionary<Guid, decimal>> _requirements = [];
        private readonly IReadOnlyDictionary<RecipeTarget, Recipe> _active =
            recipes.Where(r => !r.IsDeleted && r.Target is not null).ToDictionary(r => r.Target!.Value);

        public IReadOnlyDictionary<Guid, RawMaterial> Materials => materials;
        public IReadOnlyList<Recipe> Recipes => recipes;
        public IReadOnlyDictionary<RecipeTarget, Target> Targets => targets;
        public MaterialExplosion Explosion { get; } = new(prepRecipes);
        public RecipeCosts Costs { get; } = new(materials, prepRecipes);

        public string? CategoryName(Guid id) => categories.GetValueOrDefault(id)?.Name;
        public string? CategoryAr(Guid id) => categories.GetValueOrDefault(id)?.NameAr;

        // The recipe a dish or its size sells by: the size's own, or the dish's.
        public Recipe? RecipeFor(int menuItemId, int? variantId) =>
            (variantId is { } v ? _active.GetValueOrDefault(RecipeTarget.ForVariant(menuItemId, v)) : null)
            ?? _active.GetValueOrDefault(RecipeTarget.ForMenuItem(menuItemId));

        // What one of a sold line takes by the recipes, as stock keeps it: prep items still whole.
        public IReadOnlyDictionary<Guid, decimal> Requirements(SaleKey key)
        {
            if (!_requirements.TryGetValue(key, out var per))
                _requirements[key] = per = StockRequirements.For(key.Item(1), recipes, combos);
            return per;
        }
    }

    private async Task<Catalog> CatalogAsync(CancellationToken cancellationToken)
    {
        var materials = await db.RawMaterials.AsNoTracking().ToDictionaryAsync(m => m.Id, cancellationToken);
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, cancellationToken);
        var recipes = await db.Recipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken);
        var prepRecipes = await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken);

        // The menu as the recipes sell by it: each dish, each of its sizes, each add-on.
        var items = await db.MenuItems.AsNoTracking().Where(m => !m.IsDeleted).ToListAsync(cancellationToken);
        var variants = (await db.MenuItemVariants.AsNoTracking().ToListAsync(cancellationToken)).ToLookup(v => v.MenuItemId);
        var addOns = await db.AddOns.AsNoTracking().ToListAsync(cancellationToken);
        var targets = new Dictionary<RecipeTarget, Target>();
        foreach (var item in items)
        {
            var sizes = variants[item.Id].ToList();
            targets[RecipeTarget.ForMenuItem(item.Id)] = new Target(item.Name, item.NameAr, sizes.Count > 0 || item.IsPriceBasedOnAddons ? null : item.Price, sizes.Count == 0);
            foreach (var size in sizes)
                targets[RecipeTarget.ForVariant(item.Id, size.Id)] = new Target(
                    $"{item.Name} ({size.Name})", item.NameAr is null ? null : $"{item.NameAr} ({size.NameAr ?? size.Name})", size.Price, true);
        }
        foreach (var addOn in addOns)
            targets[RecipeTarget.ForAddOn(addOn.Id)] = new Target(addOn.Name, addOn.NameAr, addOn.Price, false);

        return new Catalog(materials, categories, recipes, prepRecipes, targets, await db.ComboPartsAsync(cancellationToken));
    }

    // The period's sales, each dish, size and add-ons together: what was sold on the bill.
    private async Task<IReadOnlyList<Sold>> SoldAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var (fromUtc, _) = clock.Bounds(from);
        var (_, toUtc) = clock.Bounds(to);
        return (await ledger.GetAsync(fromUtc, toUtc, cancellationToken))
            .SelectMany(o => o.Lines)
            .Where(l => l.OnBill && l.Quantity > 0)
            .GroupBy(l => new SaleKey(l.MenuItemId, l.VariantId, string.Join(",", l.AddOnIds.Order())))
            .Select(g => new Sold(g.Key, g.First().VariantName is { } size ? $"{g.First().MenuItemName} ({size})" : g.First().MenuItemName, g.Sum(l => l.Quantity)))
            .ToList();
    }

    // A material's book stock either side of a period and what moved it in between, by why.
    private sealed class Stock(IReadOnlyDictionary<Guid, decimal> before, IReadOnlyDictionary<(Guid, StockMovementReason), decimal> moved)
    {
        public decimal Moved(Guid id, StockMovementReason reason) => moved.GetValueOrDefault((id, reason));

        // An opening count in the period is where its stock began, not something bought.
        public decimal Opening(Guid id) => before.GetValueOrDefault(id) + Moved(id, StockMovementReason.OpeningStock);

        public decimal Closing(Guid id) => before.GetValueOrDefault(id) + moved.Where(m => m.Key.Item1 == id).Sum(m => m.Value);

        public decimal Wasted(Guid id) => -WasteReasons.Sum(r => Moved(id, r));

        // Staff meals, hospitality and tastings: taken on purpose, apart from the waste.
        public decimal Staff(Guid id) => -StaffConsumption.Reasons.Sum(r => Moved(id, r));
    }

    private async Task<Stock> StockAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var before = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc < fromUtc)
            .GroupBy(m => m.RawMaterialId)
            .Select(g => new { g.Key, Quantity = g.Sum(m => m.Quantity) })
            .ToDictionaryAsync(x => x.Key, x => x.Quantity, cancellationToken);
        var moved = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc >= fromUtc && m.OccurredAtUtc < toUtc)
            .GroupBy(m => new { m.RawMaterialId, m.Reason })
            .Select(g => new { g.Key.RawMaterialId, g.Key.Reason, Quantity = g.Sum(m => m.Quantity) })
            .ToListAsync(cancellationToken);
        return new Stock(before, moved.ToDictionary(m => (m.RawMaterialId, m.Reason), m => m.Quantity));
    }

    // A posted invoice's stock line: when it was bought (the paper's date, or the day it was posted),
    // how much in the material's own unit, the net price a unit, from whom.
    private sealed record Bought(Guid InvoiceId, Guid RawMaterialId, DateOnly Date, DateTime PostedAtUtc, decimal Quantity, decimal? UnitCost, Guid? SupplierId);

    private async Task<IReadOnlyList<Bought>> PurchasesAsync(CancellationToken cancellationToken)
    {
        var lines = await db.PurchaseInvoices.AsNoTracking()
            .Where(i => i.Status == PurchaseInvoiceStatus.Posted)
            .SelectMany(i => i.Lines.Where(l => l.RawMaterialId != null && l.Quantity > 0),
                (i, l) => new { i.Id, l.RawMaterialId, i.InvoiceDate, i.PostedAtUtc, l.Quantity, l.Cost, i.SupplierId })
            .ToListAsync(cancellationToken);
        return lines.Select(l => new Bought(
                l.Id, l.RawMaterialId!.Value, l.InvoiceDate ?? clock.BusinessDateOf(l.PostedAtUtc!.Value), l.PostedAtUtc!.Value, l.Quantity,
                l.Cost is { } cost ? cost / l.Quantity : null, l.SupplierId))
            .ToList();
    }

    // The latest net price paid a unit for each material, and who sold it.
    // The cheapest supplier is judged on the last six months' purchases: an old price is not an offer.
    public const int CheapestLookbackDays = 180;

    // Each material's cheapest supplier in the period: of each supplier's last net price, the lowest.
    private async Task<IReadOnlyDictionary<Guid, Bought>> CheapestPricesAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken) =>
        (await PurchasesAsync(cancellationToken))
            .Where(p => p.UnitCost is not null && p.Date >= from && p.Date <= to)
            .GroupBy(p => p.RawMaterialId)
            .ToDictionary(g => g.Key, g => g
                .GroupBy(p => p.SupplierId)
                .Select(s => s.OrderBy(p => p.Date).ThenBy(p => p.PostedAtUtc).Last())
                .OrderBy(p => p.UnitCost)
                .ThenByDescending(p => p.Date)
                .First());

    public async Task<VendorPriceReport> GetVendorPricesAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        Period(from, to);
        var catalog = await CatalogAsync(cancellationToken);
        var suppliers = await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);
        var bought = (await PurchasesAsync(cancellationToken)).Where(p => p.Date >= from && p.Date <= to).ToList();

        var rows = bought
            .GroupBy(p => p.RawMaterialId)
            .Where(g => catalog.Materials.ContainsKey(g.Key) && !catalog.Materials[g.Key].IsPrepItem)
            .Select(g =>
            {
                var material = catalog.Materials[g.Key];
                var size = material.PurchaseUnitSize;
                var offers = g.GroupBy(p => p.SupplierId)
                    .Select(s =>
                    {
                        var ordered = s.OrderBy(p => p.Date).ThenBy(p => p.PostedAtUtc).ToList();
                        var priced = ordered.Where(p => p.UnitCost is not null).ToList();
                        var pricedQuantity = priced.Sum(p => p.Quantity);
                        decimal? PerUnit(decimal? unitCost) => unitCost is { } c ? Money(c * size) : null;
                        return new VendorPrice(
                            s.Key, s.Key is { } id ? suppliers.GetValueOrDefault(id) ?? "A removed supplier" : "No supplier",
                            PerUnit(priced.LastOrDefault()?.UnitCost), ordered[^1].Date,
                            PerUnit(priced.Min(p => p.UnitCost)), PerUnit(priced.Max(p => p.UnitCost)),
                            pricedQuantity > 0 ? PerUnit(priced.Sum(p => p.Quantity * p.UnitCost!.Value) / pricedQuantity) : null,
                            Math.Round(ordered.Sum(p => p.Quantity) / size, 3), ordered.Select(p => p.InvoiceId).Distinct().Count(), false);
                    })
                    .OrderBy(v => v.LastPrice ?? decimal.MaxValue)
                    .ThenBy(v => v.Supplier, StringComparer.CurrentCultureIgnoreCase)
                    .ToList();
                var cheapest = offers.FirstOrDefault(v => v.LastPrice is not null);
                if (cheapest is not null)
                    offers = offers.Select(v => v.LastPrice == cheapest.LastPrice ? v with { BestPrice = true } : v).ToList();
                var lasts = offers.Where(v => v.LastPrice is > 0).Select(v => v.LastPrice!.Value).ToList();
                return new VendorPriceRow(
                    material.Id, material.Code, material.Name, material.CategoryId, catalog.CategoryName(material.CategoryId),
                    catalog.CategoryAr(material.CategoryId), material.PurchaseUnit, offers,
                    lasts.Count > 1 ? Percent(lasts.Max() / lasts.Min() - 1) : null);
            })
            .OrderByDescending(r => r.Suppliers.Count > 1)
            .ThenByDescending(r => r.SpreadPercent ?? 0)
            .ThenBy(r => r.Material, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        return new VendorPriceReport(from, to, rows.Count, rows.Count(r => r.Suppliers.Count > 1), rows);
    }

    private async Task<IReadOnlyDictionary<Guid, Bought>> LatestPricesAsync(CancellationToken cancellationToken) =>
        (await PurchasesAsync(cancellationToken))
            .Where(p => p.UnitCost is not null)
            .GroupBy(p => p.RawMaterialId)
            .ToDictionary(g => g.Key, g => g.OrderBy(p => p.Date).ThenBy(p => p.PostedAtUtc).Last());

    private (DateTime FromUtc, DateTime ToUtc) Period(DateOnly from, DateOnly to)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (to > from.AddYears(2))
            throw new DomainException("Choose two years at most. · سنتان على الأكثر.");
        return (clock.Bounds(from).FromUtc, clock.Bounds(to).ToUtc);
    }

    private static decimal Quantity(decimal value) => Math.Round(value, 3, MidpointRounding.AwayFromZero);
}
```


### 3.4.1 هندسة المنيو والربحية (Menu Engineering)

التبويب الخامس، بطريقة كاسافانا وسميث: كل طبق بِيع في الفترة يوضع في ربع من أربعة حسب **شعبيته** و **هامش مساهمته**. يُبنى على نفس مبيعات التقرير النظري (`SalesAsync` في `CostingService`)، لذلك كُتب كجزء من الصنف نفسه (`partial class`) في ملف مستقل:

```text
نسبة المبيعات (menu mix) = كمية الطبق ÷ مجموع كميات الأطباق محل التحليل
حد الشعبية             = 70% × (100% ÷ عدد الأطباق)        ← طبق "مطلوب" إن بلغه
هامش المساهمة          = متوسط سعر البيع الصافي − تكلفة طعام الحصة (مكونات وقت البيع)
متوسط الهامش           = مجموع المساهمة ÷ مجموع الكميات   ← طبق "مربح" إن بلغه
Star = مطلوب + مربح ؛ Plowhorse = مطلوب فقط ؛ Puzzle = مربح فقط ؛ Dog = لا هذا ولا ذاك
السعر المقترح          = تكلفة الحصة ÷ (النسبة المستهدفة ÷ 100)
```

لماذا المكونات فقط بلا التكاليف المشتركة؟ لأن المشتركة (زيت، غاز) شهرية، وتوزيعها على أسبوع يضخّمها أربعة أضعاف؛ فيصبح أسبوع قابلًا للمقارنة بشهر. والطبق بلا وصفة أو بلا سعر **لا يُصنَّف** بل يُعرض منفصلًا (`Status` = `NoRecipe`/`NoPrice`)، ولا تدخل كميته في حد الشعبية. ويمكن قصر التحليل على قسم واحد من المنيو (مقارنة الحلويات بالحلويات)، وقائمة الأقسام تُعاد كاملة أيًّا كان المختار.

> 📄 **`backend/src/Costing.Infrastructure/Reports/CostingService.MenuEngineering.cs`** — 159 سطر

```csharp
using Costing.Domain.Common;

namespace Costing.Infrastructure.Reports;

// Menu engineering (هندسة المنيو والربحية), as Kasavana and Smith set it out: each dish the period
// sold placed by how popular it was and how much it left after its food cost.
//
//   menu mix %            = its quantity sold ÷ every analysed dish's
//   popular               = menu mix % ≥ 70% × (100% ÷ the number of dishes analysed)
//   contribution margin   = its average net selling price − its food cost a portion
//   profitable            = its margin ≥ the average margin, weighted by quantity sold
//
//   Star (النجوم): popular and profitable. Plowhorse (خيول العمل): popular, below the average margin.
//   Puzzle (الألغاز): profitable, not popular. Dog (الأصناف الضعيفة): neither.
//
// Food cost a portion is what its ingredients cost when it was sold, as the theoretical report
// takes it (the stock movements the sale posted); shared costs are monthly and left out here, so a
// week compares with a month. A dish with no recipe or no price cannot be placed, and is listed
// apart. The suggested price is the one that brings it to the food cost target.

public enum MenuClass
{
    Star = 1,
    Plowhorse = 2,
    Puzzle = 3,
    Dog = 4,
}

public sealed record MenuEngineeringRow(
    string ItemCode,
    int MenuItemId,
    int? VariantId,
    string MenuItem,
    string? MenuItemAr,
    string Category,
    decimal QuantitySold,
    decimal? MenuMixPercent,
    decimal NetSales,
    decimal? AveragePrice,
    decimal? FoodCostPerPortion,
    decimal? FoodCostPercent,
    decimal? ContributionMargin,
    decimal? TotalContribution,
    bool Popular,
    bool Profitable,
    MenuClass? Class,
    decimal? SuggestedPrice,
    CostStatus Status);

public sealed record MenuClassSummary(MenuClass Class, int Items, decimal QuantitySold, decimal Contribution, decimal? ContributionSharePercent);

public sealed record MenuEngineeringReport(
    DateOnly From,
    DateOnly To,
    string? Category,
    decimal FoodCostTargetPercent,
    int Items,
    decimal QuantitySold,
    decimal NetSales,
    decimal TotalContribution,
    decimal? AverageContribution,
    decimal? PopularityThresholdPercent,
    decimal? FoodCostPercent,
    IReadOnlyList<MenuClassSummary> Classes,
    IReadOnlyList<MenuEngineeringRow> Rows,
    int Unclassified,
    IReadOnlyList<string> Categories);

public sealed partial class CostingService
{
    // A dish below this share of an even menu mix is not popular: 70%, as Kasavana and Smith set it.
    public const decimal PopularityFactor = 0.7m;

    public async Task<MenuEngineeringReport> GetMenuEngineeringAsync(DateOnly from, DateOnly to, string? category, CancellationToken cancellationToken)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (to > from.AddYears(2))
            throw new DomainException("Choose two years at most. · سنتان على الأكثر.");

        var settings = await SettingsAsync(cancellationToken);
        var target = settings.FoodCostTargetPercent;
        var sold = await SalesAsync(from, to, cancellationToken);
        var categories = sold.Select(s => s.Category).Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase)
            .Order(StringComparer.CurrentCultureIgnoreCase).ToList();
        var chosen = string.IsNullOrWhiteSpace(category) ? null : category.Trim();
        var dishes = sold
            .Where(s => chosen is null || string.Equals(s.Category, chosen, StringComparison.OrdinalIgnoreCase))
            .GroupBy(s => (s.MenuItemId, s.VariantId))
            .Select(g => new
            {
                Any = g.First(),
                Quantity = (decimal)g.Sum(s => s.Quantity),
                NetSales = g.Sum(s => s.NetSales),
                Ingredients = g.Sum(s => s.IngredientCost),
                HasRecipe = g.Any(s => s.HasRecipe),
                MissingPrice = g.Any(s => s.MissingPrice),
            })
            .Where(d => d.Quantity > 0)
            .ToList();

        // Placed: sold with a recipe and a price.
        var placed = dishes.Where(d => d.HasRecipe && d.NetSales > 0).ToList();
        var totalQuantity = placed.Sum(d => d.Quantity);
        var totalContribution = placed.Sum(d => d.NetSales - d.Ingredients);
        decimal? averageMargin = totalQuantity > 0 ? totalContribution / totalQuantity : null;
        decimal? threshold = placed.Count > 0 ? PopularityFactor / placed.Count : null;

        var rows = dishes.Select(d =>
            {
                var any = d.Any;
                var code = ItemCode(any.MenuItemId, any.VariantId);
                if (!d.HasRecipe || d.NetSales <= 0)
                    return new MenuEngineeringRow(
                        code, any.MenuItemId, any.VariantId, any.Name, any.NameAr, any.Category, d.Quantity, null, Money(d.NetSales),
                        d.NetSales > 0 ? Money(d.NetSales / d.Quantity) : null, null, null, null, null, false, false, null, null,
                        d.HasRecipe ? CostStatus.NoPrice : CostStatus.NoRecipe);

                var price = d.NetSales / d.Quantity;
                var cost = d.Ingredients / d.Quantity;
                var margin = price - cost;
                var mix = d.Quantity / totalQuantity;
                var popular = mix >= threshold;
                var profitable = margin >= averageMargin;
                var foodCost = Percent(cost / price);
                var status = d.MissingPrice ? CostStatus.MissingPrices : foodCost > target ? CostStatus.AboveTarget : CostStatus.WithinTarget;
                return new MenuEngineeringRow(
                    code, any.MenuItemId, any.VariantId, any.Name, any.NameAr, any.Category, d.Quantity, Math.Round(mix * 100, 2, MidpointRounding.AwayFromZero),
                    Money(d.NetSales), Money(price), Money(cost), foodCost, Money(margin), Money(d.NetSales - d.Ingredients), popular, profitable,
                    (popular, profitable) switch
                    {
                        (true, true) => MenuClass.Star,
                        (true, false) => MenuClass.Plowhorse,
                        (false, true) => MenuClass.Puzzle,
                        _ => MenuClass.Dog,
                    },
                    target > 0 ? Money(cost * 100 / target) : null, status);
            })
            .OrderBy(r => r.Class ?? (MenuClass)99).ThenByDescending(r => r.TotalContribution ?? decimal.MinValue).ThenBy(r => r.ItemCode)
            .ToList();

        var classified = rows.Where(r => r.Class is not null).ToList();
        var placedSales = placed.Sum(d => d.NetSales);
        var placedCost = placed.Sum(d => d.Ingredients);
        return new MenuEngineeringReport(
            from, to, chosen, target, classified.Count, totalQuantity, Money(placedSales), Money(totalContribution), Money(averageMargin),
            threshold is { } t ? Math.Round(t * 100, 2, MidpointRounding.AwayFromZero) : null,
            placedSales > 0 ? Percent(placedCost / placedSales) : null,
            Enum.GetValues<MenuClass>().Select(c =>
                {
                    var of = classified.Where(r => r.Class == c).ToList();
                    var contribution = of.Sum(r => r.TotalContribution ?? 0);
                    return new MenuClassSummary(c, of.Count, of.Sum(r => r.QuantitySold), Money(contribution),
                        totalContribution != 0 ? Percent(contribution / totalContribution) : null);
                })
                .ToList(),
            rows, rows.Count - classified.Count, categories);
    }
}
```


### 3.4.1.1 التكلفة الكلية للطبق (Fully Burdened Plate Cost)

هندسة المنيو تحكم على الطبق بتكلفة خاماته وحدها، والطبق يأخذ أيضًا وقت المطبخ ونصيبه من الإيجار والمرافق والإهلاك. المحرك يجمع **وعاءين** للفترة ثم يوزعهما على الأطباق المباعة:

```text
وعاء العمالة  = لكل شهر: مسير الرواتب المعتمد من HR (أو الرواتب المصروفة له) + الأجور المدخلة في المؤشرات + مصروفات بند الأجور
وعاء التشغيل  = لكل شهر: الإيجار + المصاريف القابلة للتحكم + الفوائد + الإهلاك المدخلة، + فواتير وسندات بنود الإيجار والتحكم والثابتة
كل شهر يُوزع بالتساوي على أيامه: الفترة تأخذ (أيامها فيه ÷ أيام الشهر)؛ والشهر الخالي يأخذ الرقم التقديري من الإعدادات

بالتساوي:        عمالة الطبق = الوعاء ÷ الأطباق المباعة ؛ ومثلها التشغيل
بنسبة الإيراد:    عمالة الطبق = الوعاء × سعره ÷ المبيعات ؛ ومثلها التشغيل
حسب الوقت (ABC): عمالة الطبق = الوعاء × دقائقه الموزونة ÷ Σ(الكمية × الدقائق الموزونة) ؛ والتشغيل بالتساوي

التكلفة الكلية = الخامات + العمالة + التشغيل ؛ صافي الربح = السعر قبل الضريبة − التكلفة الكلية
السعر المقترح  = التكلفة الكلية ÷ (1 − الهامش المستهدف)   أو بالإيراد: الخامات ÷ (1 − الهامش − الأوعية ÷ المبيعات)
```

الرياضيات نفسها **دوال نقية** في الـ Domain (`PlateCostAllocation`) لتُختبر وحدها: الوعاء يُحمَّل كاملًا (Σ نصيب الطبق × كميته = الوعاء)، والطبق غير المباع يأخذ ما كان سيحمله الطبق منه بالمعدلات نفسها. و `CostingService.PlateCost` يعطي نقطة البداية لكل طبق: تكلفة الخامات من بطاقة الوصفة الآن، والسعر، والكمية المباعة، والدقائق الموزونة (وقته × صعوبته + نصيبه من دقائق تشغيلات المصنّعات التي فيه، تكراريًا مع حماية من الدوران). ثم `BurdenedCostService` يجمع الأوعية ويحسب لكل طبق ويُلخّص: المحمّل من كل وعاء ومتوسطه للطبق، ومتوسط التكلفة الكلية وصافي الربح موزونين بالمبيعات، وعدد **الأطباق الخاسرة بعد التحميل** (رابحة على الخامات، خاسرة بعدها). والمجموع يُحسب من الأنصبة الدقيقة لا المقرّبة، ليساوي الوعاء حتى القرش.

> 📄 **`backend/src/Costing.Domain/Recipes/PlateCostAllocation.cs`** — 96 سطر

```csharp
namespace Costing.Domain.Recipes;

// How a period's labor and overheads are shared over the plates sold in it, for the fully burdened
// plate cost (التكلفة الكلية للطبق):
//
//   ByQuantitySold        (بالتساوي حسب الكمية المباعة)   every plate carries the same:
//                          labor a plate    = labor pool ÷ plates sold
//                          overhead a plate = overhead pool ÷ plates sold
//   ByRevenueShare        (بنسبة المساهمة في الإيراد)     by what a plate sells for:
//                          a dish's share   = its price × its quantity ÷ the period's sales
//                          labor a plate    = labor pool × its share ÷ its quantity = labor pool × its price ÷ the sales
//                          (the same for the overheads)
//   ActivityBasedPrepTime (حسب وقت التحضير - ABC)         labor by the kitchen's time, the rest by the plate:
//                          labor a plate    = labor pool × its weighted minutes ÷ Σ (quantity × weighted minutes)
//                          overhead a plate = overhead pool ÷ plates sold
//
// Shared over what was sold, the pools are allocated whole: Σ (a plate's share × its quantity) is
// the pool. A dish not sold in the period is given the share a plate of it would have carried, at
// the same rates, so its burdened cost is known before it sells.
public enum OverheadAllocationMethod
{
    ByQuantitySold = 1,
    ByRevenueShare = 2,
    ActivityBasedPrepTime = 3,
}

// A dish as the period sold it: how many plates, what one sells for (null with no price), what the
// plates sold came to (its price × its quantity; its net sales when it has no price), and the
// kitchen's weighted minutes for one plate.
public sealed record PlateDriver(decimal QuantitySold, decimal? Price, decimal Revenue, decimal WeightedMinutes);

// The period's rates, each over what was sold: null when nothing was sold to share over.
public sealed record AllocationRates(
    OverheadAllocationMethod Method,
    decimal LaborPool,
    decimal OverheadPool,
    decimal PlatesSold,
    decimal Revenue,
    decimal WeightedMinutesSold,
    decimal? LaborPerPlate,
    decimal? LaborPerRevenue,
    decimal? LaborPerWeightedMinute,
    decimal? OverheadPerPlate,
    decimal? OverheadPerRevenue)
{
    // One plate's labor and overheads, at its price and its weighted minutes. Null where the
    // method cannot place it: nothing sold in the period, or no price to share revenue by.
    public (decimal? Labor, decimal? Overhead) For(decimal? price, decimal weightedMinutes) => Method switch
    {
        OverheadAllocationMethod.ByQuantitySold => (LaborPerPlate, OverheadPerPlate),
        OverheadAllocationMethod.ByRevenueShare => (price * LaborPerRevenue, price * OverheadPerRevenue),
        _ => (LaborPerWeightedMinute * weightedMinutes, OverheadPerPlate),
    };
}

public static class PlateCostAllocation
{
    public static AllocationRates Rates(
        OverheadAllocationMethod method, decimal laborPool, decimal overheadPool, IEnumerable<PlateDriver> dishes)
    {
        var sold = dishes.Where(d => d.QuantitySold > 0).ToList();
        var plates = sold.Sum(d => d.QuantitySold);
        var revenue = sold.Sum(d => d.Revenue);
        var minutes = sold.Sum(d => d.QuantitySold * d.WeightedMinutes);
        decimal? Over(decimal pool, decimal whole) => whole > 0 ? pool / whole : null;
        return new AllocationRates(
            method, laborPool, overheadPool, plates, revenue, minutes,
            Over(laborPool, plates), Over(laborPool, revenue), Over(laborPool, minutes),
            Over(overheadPool, plates), Over(overheadPool, revenue));
    }

    // The price that leaves the target net margin after the food, the labor and the overheads. By
    // quantity or by time, a plate's labor and overheads do not move with its price:
    //   price = (food + labor + overheads) ÷ (1 − target)
    // By revenue share they do, at (pools ÷ sales) of every pound it sells for:
    //   price = food ÷ (1 − target − (labor pool + overhead pool) ÷ sales)
    // Null when no price reaches it: the pools take as much of each pound as the margin leaves.
    public static decimal? SuggestedPrice(AllocationRates rates, decimal foodCost, decimal weightedMinutes, decimal targetNetMarginPercent)
    {
        var target = targetNetMarginPercent / 100;
        if (target >= 1)
            return null;
        if (rates.Method == OverheadAllocationMethod.ByRevenueShare)
        {
            if (rates.LaborPerRevenue is not { } labor || rates.OverheadPerRevenue is not { } overhead)
                return null;
            var left = 1 - target - labor - overhead;
            return left > 0 ? foodCost / left : null;
        }

        var (perPlateLabor, perPlateOverhead) = rates.For(null, weightedMinutes);
        if (perPlateLabor is not { } l || perPlateOverhead is not { } o)
            return null;
        return (foodCost + l + o) / (1 - target);
    }
}
```


> 📄 **`backend/src/Costing.Infrastructure/Reports/CostingService.PlateCost.cs`** — 136 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Production;
using Costing.Domain.Recipes;

namespace Costing.Infrastructure.Reports;

// A dish as the fully burdened plate cost starts from: what one plate's ingredients cost now (its
// recipe card's cost per portion, prep items by RecipeCosts, shared costs included), what it sells
// for before VAT, how many plates the period sold, and the kitchen's weighted minutes for a plate.
//
// Weighted minutes: the dish's own prep time × its complexity, and its share of each prep item it
// is made with: a batch's prep time × its complexity, over what the batch makes, for what one plate
// takes of it, as purchased. A pizza with 250 g of a 10 kg dough batch that takes 60 minutes
// carries 1.5 of them.
internal sealed record PlateBase(
    string ItemCode,
    int? MenuItemId,
    int? VariantId,
    Guid? RecipeId,
    string Dish,
    string? DishAr,
    string? Category,
    // On the menu now; off it: an off-menu (R&D) recipe at its planned price, or a dish sold in the
    // period that has left the menu since.
    bool OnMenu,
    decimal QuantitySold,
    decimal NetSales,
    // The menu's price, or the planned price off it; sold without a price, its average net price.
    decimal? Price,
    decimal? FoodCost,
    bool HasRecipe,
    bool MissingPrices,
    decimal? PrepTimeMinutes,
    decimal ComplexityWeight,
    decimal WeightedMinutes,
    bool PrepTimeAssumed);

public sealed partial class CostingService
{
    internal async Task<IReadOnlyList<PlateBase>> PlateBasesAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        var prepRecipes = await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToDictionaryAsync(r => r.PrepItemId, cancellationToken);
        var minutesPerUnit = new PrepMinutes(prepRecipes);

        var sold = (await SalesAsync(from, to, cancellationToken))
            .GroupBy(s => (s.MenuItemId, s.VariantId))
            .ToDictionary(g => g.Key, g => (
                Any: g.First(), Quantity: (decimal)g.Sum(s => s.Quantity), NetSales: g.Sum(s => s.NetSales),
                Ingredients: g.Sum(s => s.IngredientCost), HasRecipe: g.Any(s => s.HasRecipe), Missing: g.Any(s => s.MissingPrice)));

        decimal Weighted(Recipe? recipe) =>
            recipe is null
                ? PlateActivity.Default.WeightedMinutes
                : recipe.Activity.WeightedMinutes + recipe.Ingredients.Sum(i => i.AsPurchasedQuantity / recipe.Portions * minutesPerUnit.Of(i.RawMaterialId));

        var rows = new List<PlateBase>();
        var seen = new HashSet<(int, int?)>();
        foreach (var target in data.Targets.Where(t => t.Kind == RecipeTargetKind.MenuItem))
        {
            var key = (target.CatalogItemId, target.VariantId);
            var hasSizes = target.VariantId is null && data.Targets.Any(t => t.Kind == RecipeTargetKind.MenuItem && t.CatalogItemId == target.CatalogItemId && t.VariantId is not null);
            var sale = sold.GetValueOrDefault(key);
            // A dish sold by its sizes: each size is a plate, the dish itself never is.
            if (hasSizes && sale.Quantity == 0)
                continue;
            seen.Add(key);

            var own = data.Recipes.GetValueOrDefault(new RecipeTarget(target.Kind, target.CatalogItemId, target.VariantId));
            var recipe = own ?? (target.VariantId is not null ? data.Recipes.GetValueOrDefault(RecipeTarget.ForMenuItem(target.CatalogItemId)) : null);
            var card = CardOf(target);
            var price = target.PricedByAddOns ? null : target.Price;
            if (price is null && sale.Quantity > 0 && sale.NetSales > 0)
                price = sale.NetSales / sale.Quantity;
            rows.Add(new PlateBase(
                card.ItemCode, target.CatalogItemId, target.VariantId, recipe?.Id, target.Name, target.NameAr, target.Category, true,
                sale.Quantity, sale.NetSales, price, card.HasRecipe ? card.CostPerPortion : null, card.HasRecipe, card.MissingPrices.Count > 0,
                recipe?.PrepTimeMinutes, recipe?.ComplexityWeight ?? PlateActivity.DefaultComplexityWeight,
                // A combo's plate is its dishes': their weighted minutes, as many as it holds.
                ComboOf(target, data) is { } combo ? combo.Parts.Sum(p => Weighted(data.AllRecipes.FirstOrDefault(r => r.Id == p.RecipeId)) * p.Quantity) : Weighted(recipe),
                recipe is null || recipe.PrepTimeMinutes is null));
        }

        // Sold in the period and gone from the menu since: its plates were made and served all the
        // same, at what their ingredients cost when sold.
        foreach (var ((menuItemId, variantId), sale) in sold.Where(s => !seen.Contains(s.Key)))
        {
            var any = sale.Any;
            rows.Add(new PlateBase(
                ItemCode(menuItemId, variantId), menuItemId, variantId, null, any.Name, any.NameAr, any.Category.Length > 0 ? any.Category : null, false,
                sale.Quantity, sale.NetSales, sale.NetSales > 0 ? sale.NetSales / sale.Quantity : null,
                sale.HasRecipe ? sale.Ingredients / sale.Quantity : null, sale.HasRecipe, sale.Missing,
                null, PlateActivity.DefaultComplexityWeight, PlateActivity.Default.WeightedMinutes, true));
        }

        // Off the menu: a dish being planned, at its planned price, so its burdened cost is known
        // before it goes on the menu.
        foreach (var recipe in data.AllRecipes.Where(r => !r.IsDeleted && !r.IsLinked))
        {
            var card = Card(recipe, data);
            rows.Add(new PlateBase(
                "", null, null, recipe.Id, card.Recipe, null, card.Category, false, 0, 0, recipe.PlannedPrice, card.CostPerPortion, true,
                card.MissingPrices.Count > 0, recipe.PrepTimeMinutes, recipe.ComplexityWeight, Weighted(recipe), recipe.PrepTimeMinutes is null));
        }
        return rows;

        RecipeCostCard CardOf(Target target)
        {
            if (ComboOf(target, data) is not null)
                return Card(target, data);
            var own = data.Recipes.GetValueOrDefault(new RecipeTarget(target.Kind, target.CatalogItemId, target.VariantId));
            var recipe = own ?? (target.VariantId is not null ? data.Recipes.GetValueOrDefault(RecipeTarget.ForMenuItem(target.CatalogItemId)) : null);
            return CostingService.Card(target, recipe, own is null && recipe is not null, data);
        }
    }

    // The kitchen's weighted minutes in one gram, millilitre or piece of a prep item: its batch's
    // minutes, and those of the prep items it is made with, over what the batch makes. A bought
    // material takes none; a prep item made with itself (never saved) stops there.
    private sealed class PrepMinutes(IReadOnlyDictionary<Guid, PrepRecipe> recipes)
    {
        private readonly Dictionary<Guid, decimal> _known = [];
        private readonly HashSet<Guid> _working = [];

        public decimal Of(Guid materialId)
        {
            if (_known.TryGetValue(materialId, out var known))
                return known;
            if (!recipes.TryGetValue(materialId, out var recipe) || recipe.BatchQuantity <= 0 || !_working.Add(materialId))
                return 0;
            var minutes = (recipe.Activity.WeightedMinutes + recipe.Ingredients.Sum(i => i.AsPurchasedQuantity * Of(i.RawMaterialId))) / recipe.BatchQuantity;
            _working.Remove(materialId);
            return _known[materialId] = minutes;
        }
    }
}
```


> 📄 **`backend/src/Costing.Infrastructure/Reports/BurdenedCostService.cs`** — 346 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Categories;
using Costing.Domain.Common;
using Costing.Domain.Recipes;
using Costing.Domain.StockMovements;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// The fully burdened plate cost (محرك التكلفة الكلية للطبق): each dish's food, its share of the
// period's labor and of its overheads, and what is left of its price after all three.
//
//   Fully burdened cost  = food cost + allocated labor + allocated overheads
//   Prime cost           = food cost + allocated labor
//   True net profit      = selling price (before VAT) − fully burdened cost; × plates sold for the period
//   True net margin %    = true net profit ÷ selling price × 100
//
// The pools, for the days chosen. Each month is taken whole and spread evenly over its days, so a
// rent paid on the 1st, or a payroll approved on the 30th, is carried by every plate of the month,
// and a part of a month carries its share by days (15 of 30 days: half):
//
//   Labor     the month's payroll approved on HR (its labor cost), or the salaries paid from the safe
//             for it when HR sent none, the wages and benefits entered for it on the KPIs, and the
//             expense invoices and vouchers filed under a Wages category: as the KPIs' labor cost.
//   Overheads the month's occupation (rent), controllable costs (utilities, running costs),
//             interest and depreciation entered on the KPIs, and its expense invoices and vouchers
//             under an Occupation, Controllable or Other fixed category: the P&L's overheads.
//
// A month with nothing recorded for a pool takes the cost settings' stand-in monthly figure for it
// when one is set, and says so. Simulated, the pools are the monthly figures given instead, spread
// the same way. Food cost is each recipe card's cost per portion now: the moving averages, prep
// items by their batches (or their recipes before the first), and the shared costs.
public enum PoolSource
{
    Actual = 1,
    Simulated = 2,
}

public enum PlateStatus
{
    // At or above the target net margin.
    Healthy = 1,
    // Profitable, below the target.
    Thin = 2,
    // Losing money once labor and overheads are added.
    Losing = 3,
    NoRecipe = 4,
    NoPrice = 5,
    // Nothing was sold in the period to share the pools over.
    NotAllocated = 6,
}

// One part of a pool, as the screen and the sheet list them.
public sealed record CostPoolPart(string Key, string Label, string LabelAr, decimal Amount);

// A pool for the days: its parts, and the months that took the stand-in figure.
public sealed record CostPool(decimal Total, IReadOnlyList<CostPoolPart> Parts, IReadOnlyList<string> StandInMonths);

public sealed record BurdenedPlateRow(
    string ItemCode,
    int? MenuItemId,
    int? VariantId,
    Guid? RecipeId,
    string Dish,
    string? DishAr,
    string? Category,
    bool OnMenu,
    decimal QuantitySold,
    // Not sold in the period: its shares are what a plate of it would have carried.
    bool Estimated,
    decimal? SellingPrice,
    decimal? PrepTimeMinutes,
    decimal ComplexityWeight,
    decimal WeightedMinutes,
    bool PrepTimeAssumed,
    decimal? DirectFoodCost,
    decimal? FoodCostPercent,
    decimal? AllocatedLaborCost,
    decimal? LaborCostPercent,
    decimal? PrimeCost,
    decimal? PrimeCostPercent,
    decimal? AllocatedOverheadCost,
    decimal? OverheadCostPercent,
    decimal? FullyBurdenedCost,
    decimal? FullyBurdenedCostPercent,
    decimal? TrueNetProfitPerPlate,
    decimal? TrueNetMarginPercent,
    decimal? TotalPeriodNetProfit,
    decimal? SuggestedPriceForTargetNetMargin,
    // Above its food cost, below zero once labor and overheads are added (أطباق خاسرة بعد التحميل).
    bool BleedingAfterOverhead,
    bool MissingPrices,
    PlateStatus Status);

public sealed record BurdenedCostReport(
    DateOnly From,
    DateOnly To,
    int Days,
    OverheadAllocationMethod Method,
    PoolSource Source,
    decimal TargetNetMarginPercent,
    CostPool Labor,
    CostPool Overhead,
    decimal PlatesSold,
    decimal Sales,
    // The rates the pools were shared at: a plate, a pound of sales, a weighted minute.
    decimal? LaborPerPlate,
    decimal? LaborPerRevenue,
    decimal? LaborPerWeightedMinute,
    decimal? OverheadPerPlate,
    decimal? OverheadPerRevenue,
    // What the plates sold carried: each pool's allocated part, and on average a plate.
    decimal LaborAllocated,
    decimal? AverageLaborPerPlate,
    decimal OverheadAllocated,
    decimal? AverageOverheadPerPlate,
    // Over the plates sold, weighted by their sales.
    decimal? AverageFullyBurdenedCostPercent,
    decimal? AverageTrueNetMarginPercent,
    decimal TotalPeriodNetProfit,
    int DishesBleeding,
    IReadOnlyList<BurdenedPlateRow> Rows,
    IReadOnlyList<string> Categories);

// One recipe's burdened plate, for its card: the month so far, as the cost settings share it.
public sealed record BurdenedRecipeCost(
    DateOnly From, DateOnly To, OverheadAllocationMethod Method, decimal TargetNetMarginPercent, decimal PlatesSold, BurdenedPlateRow? Plate);

public sealed class BurdenedCostService(CostingDbContext db, Application.Common.IBusinessCalendar clock, CostingService costing, PurchaseSpendingService spending, FixedAssetService fixedAssets)
{
    private static readonly ExpenseLine[] OverheadLines = [ExpenseLine.Occupation, ExpenseLine.Controllable, ExpenseLine.OtherFixed];

    public async Task<BurdenedCostReport> GetAsync(
        DateOnly from, DateOnly to, OverheadAllocationMethod? method, PoolSource source, decimal? monthlyLabor, decimal? monthlyOverhead,
        CancellationToken cancellationToken)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (to > from.AddYears(2))
            throw new DomainException("Choose two years at most. · سنتان على الأكثر.");
        if (method is { } m && !Enum.IsDefined(m))
            throw new DomainException("Choose how labor and overheads are shared. · اختر طريقة التحميل.");
        if (monthlyLabor < 0 || monthlyOverhead < 0)
            throw new DomainException("A month's labor or overheads cannot be negative. · المصاريف الشهرية لا تكون سالبة.");

        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var chosen = method ?? settings.DefaultOverheadAllocationMethod;
        var (labor, overhead) = source == PoolSource.Simulated
            ? Simulated(from, to, monthlyLabor ?? settings.FallbackMonthlyLaborCost ?? 0, monthlyOverhead ?? settings.FallbackMonthlyOverheadCost ?? 0)
            : await ActualAsync(from, to, settings, cancellationToken);

        var bases = await costing.PlateBasesAsync(from, to, cancellationToken);
        var rates = PlateCostAllocation.Rates(chosen, labor.Total, overhead.Total,
            bases.Select(b => new PlateDriver(b.QuantitySold, b.Price, b.Price is { } p ? p * b.QuantitySold : b.NetSales, b.WeightedMinutes)));
        var target = settings.TargetNetMarginPercent;
        var rows = bases.Select(b => Row(b, rates, target))
            .OrderByDescending(r => r.QuantitySold > 0)
            .ThenBy(r => r.TrueNetMarginPercent ?? decimal.MaxValue)
            .ThenBy(r => r.Dish, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        var sold = rows.Where(r => r.QuantitySold > 0).ToList();
        // What the plates sold carried, from their exact shares: the pool, to the piastre.
        var shares = bases.Where(x => x.QuantitySold > 0).Select(x => (x.QuantitySold, Share: rates.For(x.Price, x.WeightedMinutes))).ToList();
        var laborAllocated = shares.Sum(x => (x.Share.Labor ?? 0) * x.QuantitySold);
        var overheadAllocated = shares.Sum(x => (x.Share.Overhead ?? 0) * x.QuantitySold);
        var weighed = sold.Where(r => r is { SellingPrice: > 0, FullyBurdenedCost: not null }).ToList();
        var weighedSales = weighed.Sum(r => r.SellingPrice!.Value * r.QuantitySold);
        decimal? Weighted(Func<BurdenedPlateRow, decimal> value) =>
            weighedSales > 0 ? Percent(weighed.Sum(r => value(r) * r.QuantitySold) / weighedSales) : null;

        return new BurdenedCostReport(
            from, to, to.DayNumber - from.DayNumber + 1, chosen, source, target, labor, overhead, rates.PlatesSold, Money(rates.Revenue),
            Money(rates.LaborPerPlate), Round6(rates.LaborPerRevenue), Round6(rates.LaborPerWeightedMinute), Money(rates.OverheadPerPlate),
            Round6(rates.OverheadPerRevenue),
            Money(laborAllocated), rates.PlatesSold > 0 ? Money(laborAllocated / rates.PlatesSold) : null,
            Money(overheadAllocated), rates.PlatesSold > 0 ? Money(overheadAllocated / rates.PlatesSold) : null,
            Weighted(r => r.FullyBurdenedCost!.Value), Weighted(r => r.SellingPrice!.Value - r.FullyBurdenedCost!.Value),
            Money(sold.Sum(r => r.TotalPeriodNetProfit ?? 0)),
            rows.Count(r => r.BleedingAfterOverhead), rows,
            rows.Select(r => r.Category).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.CurrentCultureIgnoreCase).ToList());
    }

    // The recipe's plate over the month so far, actual pools, the settings' method: its card's box.
    public async Task<BurdenedRecipeCost> GetForRecipeAsync(Guid recipeId, CancellationToken cancellationToken)
    {
        var recipe = await db.Recipes.AsNoTracking().SingleOrDefaultAsync(r => r.Id == recipeId, cancellationToken)
            ?? throw new NotFoundException(nameof(Recipe), recipeId);
        var today = clock.BusinessDateOf(DateTime.UtcNow);
        var report = await GetAsync(new DateOnly(today.Year, today.Month, 1), today, null, PoolSource.Actual, null, null, cancellationToken);
        var plate = report.Rows.FirstOrDefault(r => recipe.Target is { } t
                ? r.MenuItemId == t.CatalogItemId && r.VariantId == t.VariantId
                : r.RecipeId == recipeId && r.MenuItemId is null);
        return new BurdenedRecipeCost(report.From, report.To, report.Method, report.TargetNetMarginPercent, report.PlatesSold, plate);
    }

    private static BurdenedPlateRow Row(PlateBase b, AllocationRates rates, decimal target)
    {
        var (laborExact, overheadExact) = rates.For(b.Price, b.WeightedMinutes);
        var food = b.FoodCost;
        var price = b.Price;
        decimal? Share(decimal? part) => part is { } p && price > 0 ? Percent(p / price.Value) : null;
        decimal? prime = food + laborExact;
        decimal? burdened = prime + overheadExact;
        decimal? profit = price - burdened;
        var status = !b.HasRecipe ? PlateStatus.NoRecipe
            : laborExact is null || overheadExact is null ? (price is null ? PlateStatus.NoPrice : PlateStatus.NotAllocated)
            : price is not > 0 ? PlateStatus.NoPrice
            : profit < 0 ? PlateStatus.Losing
            : profit / price * 100 < target ? PlateStatus.Thin
            : PlateStatus.Healthy;
        var suggested = food is { } f ? PlateCostAllocation.SuggestedPrice(rates, f, b.WeightedMinutes, target) : null;
        return new BurdenedPlateRow(
            b.ItemCode, b.MenuItemId, b.VariantId, b.RecipeId, b.Dish, b.DishAr, b.Category, b.OnMenu, b.QuantitySold, b.QuantitySold == 0,
            Money(price), b.PrepTimeMinutes, b.ComplexityWeight, Math.Round(b.WeightedMinutes, 2, MidpointRounding.AwayFromZero), b.PrepTimeAssumed,
            Money(food), Share(food), Money(laborExact), Share(laborExact), Money(prime), Share(prime), Money(overheadExact), Share(overheadExact),
            Money(burdened), Share(burdened), Money(profit), Share(profit), Money(profit * b.QuantitySold), Money(suggested),
            price - food > 0 && profit < 0, b.MissingPrices, status);
    }

    // Each month's figures, spread evenly over its days: the part of it the days chosen cover.
    private static IEnumerable<(DateOnly Month, decimal Share)> Months(DateOnly from, DateOnly to)
    {
        for (var month = new DateOnly(from.Year, from.Month, 1); month <= to; month = month.AddMonths(1))
        {
            var last = month.AddMonths(1).AddDays(-1);
            var first = from > month ? from : month;
            var end = to < last ? to : last;
            yield return (month, (decimal)(end.DayNumber - first.DayNumber + 1) / (last.DayNumber - month.DayNumber + 1));
        }
    }

    private static (CostPool Labor, CostPool Overhead) Simulated(DateOnly from, DateOnly to, decimal monthlyLabor, decimal monthlyOverhead)
    {
        var months = Months(from, to).Sum(m => m.Share);
        return (
            new CostPool(Money(monthlyLabor * months), [new("simulated", "Simulated monthly labor", "عمالة تقديرية شهرية", Money(monthlyLabor * months))], []),
            new CostPool(Money(monthlyOverhead * months), [new("simulated", "Simulated monthly overheads", "مصاريف تشغيل تقديرية شهرية", Money(monthlyOverhead * months))], []));
    }

    // The days' share of each pool, as recorded (a month with nothing recorded for one: its stand-in).
    // The daily break-even reads a whole month of them as its fixed costs.
    internal async Task<(CostPool Labor, CostPool Overhead)> ActualAsync(DateOnly from, DateOnly to, CostingSettings settings, CancellationToken cancellationToken)
    {
        var months = Months(from, to).ToList();
        var periods = months.Select(m => m.Month).ToList();
        var entered = await db.MonthlyExpenses.AsNoTracking()
            .Where(e => e.Year >= from.Year && e.Year <= to.Year)
            .ToListAsync(cancellationToken);
        var payrolls = await db.PayrollRuns.AsNoTracking().Where(r => periods.Contains(r.Period))
            .Select(r => new { r.Period, r.LaborCost }).ToListAsync(cancellationToken);
        var salaries = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.SalaryPayment && t.PayrollMonth != null && periods.Contains(t.PayrollMonth.Value))
            .GroupBy(t => t.PayrollMonth!.Value)
            .Select(g => new { Month = g.Key, Paid = -g.Sum(t => t.Amount) })
            .ToListAsync(cancellationToken);

        // Staff meals (labor) and hospitality and tastings (overheads), each month's whole, at the cost then.
        var (consumedFrom, _) = clock.Bounds(months[0].Month);
        var (_, consumedTo) = clock.Bounds(months[^1].Month.AddMonths(1).AddDays(-1));
        var consumed = (await db.StockMovements.AsNoTracking()
                .Where(m => m.OccurredAtUtc >= consumedFrom && m.OccurredAtUtc < consumedTo && StaffConsumption.Reasons.Contains(m.Reason) && m.UnitCost != null)
                .Select(m => new { m.OccurredAtUtc, m.Reason, Value = -m.Quantity * m.UnitCost!.Value })
                .ToListAsync(cancellationToken))
            .Select(m => (Month: clock.BusinessDateOf(m.OccurredAtUtc), m.Reason, m.Value))
            .ToList();
        decimal Consumed(DateOnly month, params StockMovementReason[] reasons) =>
            consumed.Where(c => c.Month.Year == month.Year && c.Month.Month == month.Month && reasons.Contains(c.Reason)).Sum(c => c.Value);

        decimal payroll = 0, salariesPaid = 0, wagesEntered = 0, wagesLogged = 0, laborStandIn = 0, staffMeals = 0, hospitality = 0;
        decimal occupation = 0, controllable = 0, otherFixed = 0, interest = 0, depreciation = 0, overheadStandIn = 0;
        var laborStandInMonths = new List<string>();
        var overheadStandInMonths = new List<string>();
        foreach (var (month, share) in months)
        {
            var e = entered.SingleOrDefault(x => x.Year == month.Year && x.Month == month.Month);
            var logged = await spending.LoggedExpensesAsync(month, month.AddMonths(1).AddDays(-1), cancellationToken);
            decimal Logged(ExpenseLine line) => logged.Where(l => l.ExpenseLine == line).Sum(l => l.Amount);

            staffMeals += Consumed(month, StockMovementReason.StaffMeal) * share;
            hospitality += Consumed(month, StockMovementReason.Hospitality, StockMovementReason.RecipeTasting) * share;
            var run = payrolls.SingleOrDefault(r => r.Period == month);
            var paid = salaries.SingleOrDefault(s => s.Month == month)?.Paid ?? 0;
            var laborRecorded = run is not null || paid != 0 || e?.WagesAndBenefits is not null || Logged(ExpenseLine.Wages) != 0;
            if (!laborRecorded && settings.FallbackMonthlyLaborCost is { } laborFallback)
            {
                laborStandIn += laborFallback * share;
                laborStandInMonths.Add($"{month:MMM yyyy}");
            }
            else
            {
                if (run is not null)
                    payroll += run.LaborCost * share;
                else
                    salariesPaid += paid * share;
                wagesEntered += (e?.WagesAndBenefits ?? 0) * share;
                wagesLogged += Logged(ExpenseLine.Wages) * share;
            }

            // The fixed assets register's depreciation for the month, with any entered.
            var assetDepreciation = (await fixedAssets.MonthAsync(month, cancellationToken)).Depreciation;
            var overheadRecorded = e is { OccupationCost: not null } or { OtherControllableCosts: not null } or { Interest: not null } or { Depreciation: not null }
                || OverheadLines.Any(l => Logged(l) != 0) || assetDepreciation != 0;
            if (!overheadRecorded && settings.FallbackMonthlyOverheadCost is { } overheadFallback)
            {
                overheadStandIn += overheadFallback * share;
                overheadStandInMonths.Add($"{month:MMM yyyy}");
            }
            else
            {
                occupation += ((e?.OccupationCost ?? 0) + Logged(ExpenseLine.Occupation)) * share;
                controllable += ((e?.OtherControllableCosts ?? 0) + Logged(ExpenseLine.Controllable)) * share;
                otherFixed += Logged(ExpenseLine.OtherFixed) * share;
                interest += (e?.Interest ?? 0) * share;
                depreciation += ((e?.Depreciation ?? 0) + assetDepreciation) * share;
            }
        }

        static CostPool Pool(IReadOnlyList<string> standIn, params CostPoolPart[] parts)
        {
            var kept = parts.Where(p => p.Amount != 0).Select(p => p with { Amount = Money(p.Amount) }).ToList();
            return new CostPool(kept.Sum(p => p.Amount), kept, standIn);
        }

        return (
            Pool(laborStandInMonths,
                new("payroll", "Payroll approved on HR", "مسير الرواتب المعتمد", payroll),
                new("salaries", "Salaries paid from the safe", "الرواتب المصروفة من الخزنة", salariesPaid),
                new("wagesEntered", "Wages & benefits entered", "الأجور والمزايا المدخلة", wagesEntered),
                new("wagesLogged", "Wages paid as expenses", "أجور مسجلة كمصروفات", wagesLogged),
                new("staffMeals", "Staff meals", "وجبات العاملين", staffMeals),
                new("standIn", "Stand-in monthly labor", "عمالة شهرية تقديرية", laborStandIn)),
            Pool(overheadStandInMonths,
                new("occupation", "Rent & occupation", "الإيجار والمكان", occupation),
                new("controllable", "Utilities & running costs", "المرافق ومصاريف التشغيل", controllable),
                new("otherFixed", "Other fixed costs", "مصاريف ثابتة أخرى", otherFixed),
                new("interest", "Interest", "الفوائد", interest),
                new("depreciation", "Depreciation", "الإهلاك", depreciation),
                new("hospitality", "Hospitality & recipe tastings", "الضيافة وتجارب الوصفات", hospitality),
                new("standIn", "Stand-in monthly overheads", "مصاريف تشغيل شهرية تقديرية", overheadStandIn)));
    }

    private static decimal? Round6(decimal? value) => value is { } v ? Math.Round(v, 6, MidpointRounding.AwayFromZero) : null;
}
```


### 3.4.2 كارتة الصنف (Stock Card): حركة الصنف بالتفصيل

دفتر الحركات append-only (الفصل 03)، فكارتة الصنف **قراءة** له لا جدولًا جديدًا: كل حركات الخامة (أو المصنّع) حتى آخر يوم مرتبة بالوقت، ثم **إعادة تشغيل** المتوسط المرجح عليها كما تفعله `RawMaterial` نفسها:

```text
شراء أو تشغيلة مُسعّرة (ليست إلغاء)  ⇐ المتوسط = (max(الرصيد,0) × المتوسط + الكمية × السعر) ÷ (max(الرصيد,0) + الكمية)
إلغاء شراء أو تشغيلة                 ⇐ يُستبعد سعرها: (الرصيد × المتوسط − الكمية × سعرها) ÷ (الرصيد − الكمية) إن بقي رصيد
أي حركة أخرى بسعر (بيع، جرد، هالك)  ⇐ المتوسط = سعرها (كان المتوسط وقتها؛ فيلتقط أي سعر كُتب يدويًا)
الرصيد بعد الحركة = الرصيد قبلها + كميتها (على كامل الدفتر، مهما كان الفلتر)
```

رصيد أول المدة = مجموع الحركات قبل أول يوم؛ الوارد = الحركات الموجبة؛ المنصرف = السالبة؛ آخر المدة = أول + وارد − منصرف، وقيمته بالمتوسط وقتها. والفلتر (افتتاحي، مشتريات، إنتاج، مبيعات، هالك، تسوية جرد) يقصر **السطور** فقط، والأرصدة تبقى أرصدة الدفتر.

ولكل سطر **مصدره** ليُفتح بضغطة: `SourceId` في الحركة هو الفاتورة أو أمر الإنتاج أو الجرد كما هو، أما البيع فيحمل رقم **سطر** الإيصال (`PublicId`)، فيُترجم إلى الإيصال نفسه بـ `SelectMany` على السطور المملوكة (owned) ومعه يوم عمله. والتالف بلا كيان، فبيانه سببه (`Note`). و `HasSource` يقول إن السجل وُجد. الكميات بوحدة الشراء والأسعار لكل وحدة شراء، كما تعرضها الشاشات.

> 📄 **`backend/src/Costing.Infrastructure/Reports/StockCardService.cs`** — 316 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Sales;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Reports;

// The item's stock card (كارتة الصنف / حركة الصنف): every movement of one material or prep item over
// a period, oldest first, as a store ledger is kept: what came in, what went out, the balance after
// each, the price it moved at, and the moving average it left. Each line names what made it (an
// invoice, a batch, a count, a day's sales, spoilage) so it opens from here.
// Quantities are in the material's purchase unit, prices per it, as the screens show them.

// The kinds of movement the card is filtered by.
public enum StockCardMovementType
{
    Opening = 1,
    Purchases = 2,
    Production = 3,
    Sales = 4,
    Waste = 5,
    CountAdjustment = 6,
}

// What a line opens: the record that made the movement.
public enum StockCardSourceKind
{
    PurchaseInvoice = 1,
    ProductionOrder = 2,
    StockCount = 3,
    SalesReceipt = 4,
    Spoilage = 5,
}

// One movement. SourceId opens it: the invoice, the production order, the count, the sales receipt
// (not the line, which is what the ledger keeps); for spoilage, the entry's own id. SourceDate is the
// day that record is under (an invoice's paper date, a sale's business day), for opening it there.
// HasSource: that record was found; stock received without an invoice has none to open.
public sealed record StockCardLine(
    Guid MovementId,
    DateOnly Date,
    DateTime OccurredAtUtc,
    StockMovementReason Reason,
    StockCardMovementType Type,
    bool IsReversal,
    StockCardSourceKind SourceKind,
    Guid SourceId,
    bool HasSource,
    DateOnly? SourceDate,
    string Reference,
    string? Details,
    decimal QuantityIn,
    decimal QuantityOut,
    decimal Balance,
    decimal? UnitCost,
    decimal? Value,
    decimal? AverageCostAfter,
    string? RecordedBy);

// The card: the balance it opened the period with and at what average, what came in and went out in
// it (every movement, whatever the filter), what it closed with and its worth at the average then;
// and the material as it stands now. Lines: the period's movements, of Type only when it is given.
public sealed record StockCard(
    Guid RawMaterialId,
    string? Code,
    string Material,
    bool IsPrepItem,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    DateOnly From,
    DateOnly To,
    StockCardMovementType? Type,
    decimal OpeningBalance,
    decimal? OpeningAverageCost,
    decimal TotalIn,
    decimal TotalOut,
    decimal ClosingBalance,
    decimal? ClosingAverageCost,
    decimal? ClosingValue,
    decimal OnHand,
    decimal? AverageCost,
    IReadOnlyList<StockCardLine> Lines);

public sealed class StockCardService(CostingDbContext db, IBusinessCalendar clock)
{
    public static StockCardMovementType TypeOf(StockMovementReason reason) => reason switch
    {
        StockMovementReason.OpeningStock => StockCardMovementType.Opening,
        StockMovementReason.Purchase => StockCardMovementType.Purchases,
        StockMovementReason.ProductionInput or StockMovementReason.ProductionOutput => StockCardMovementType.Production,
        StockMovementReason.Sale or StockMovementReason.VoidReturn => StockCardMovementType.Sales,
        StockMovementReason.Waste or StockMovementReason.Spoilage => StockCardMovementType.Waste,
        // Taken on purpose, kept apart from spoilage everywhere it is judged; here, out like waste.
        StockMovementReason.StaffMeal or StockMovementReason.Hospitality or StockMovementReason.RecipeTasting => StockCardMovementType.Waste,
        _ => StockCardMovementType.CountAdjustment,
    };

    private static StockCardSourceKind SourceOf(StockMovementReason reason) => reason switch
    {
        StockMovementReason.Purchase => StockCardSourceKind.PurchaseInvoice,
        StockMovementReason.ProductionInput or StockMovementReason.ProductionOutput => StockCardSourceKind.ProductionOrder,
        StockMovementReason.OpeningStock or StockMovementReason.CountAdjustment => StockCardSourceKind.StockCount,
        StockMovementReason.Spoilage => StockCardSourceKind.Spoilage,
        StockMovementReason.StaffMeal or StockMovementReason.Hospitality or StockMovementReason.RecipeTasting => StockCardSourceKind.Spoilage,
        _ => StockCardSourceKind.SalesReceipt,
    };

    public async Task<StockCard> GetAsync(Guid materialId, DateOnly? from, DateOnly? to, StockCardMovementType? type, CancellationToken cancellationToken)
    {
        if (type is { } t && !Enum.IsDefined(t))
            throw new DomainException("Choose a kind of movement. · اختر نوع الحركة.");
        var last = to ?? clock.BusinessDateOf(DateTime.UtcNow);
        var first = from ?? new DateOnly(last.Year, last.Month, 1);
        if (last < first)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (last > first.AddYears(5))
            throw new DomainException("Choose five years at most. · خمس سنوات على الأكثر.");
        var fromUtc = clock.Bounds(first).FromUtc;
        var toUtc = clock.Bounds(last).ToUtc;

        var material = await db.RawMaterials.AsNoTracking().SingleOrDefaultAsync(m => m.Id == materialId, cancellationToken)
            ?? throw new NotFoundException("Raw material", materialId);
        // The whole ledger, to know the balance and the average at each step; only the period is shown.
        var movements = await db.StockMovements.AsNoTracking()
            .Where(m => m.RawMaterialId == materialId && m.OccurredAtUtc < toUtc)
            .OrderBy(m => m.OccurredAtUtc).ThenBy(m => m.Id)
            .ToListAsync(cancellationToken);

        var byId = movements.ToDictionary(m => m.Id);
        var size = material.PurchaseUnitSize;
        decimal? average = null;
        decimal onHand = 0;
        decimal? openingAverage = null;
        decimal opening = 0;
        var openingTaken = false;
        var shown = new List<(StockMovement Movement, decimal Balance, decimal? Average)>();
        foreach (var m in movements)
        {
            if (!openingTaken && m.OccurredAtUtc >= fromUtc)
            {
                (opening, openingAverage, openingTaken) = (onHand, average, true);
            }
            average = AverageAfter(average, onHand, m, m.ReversalOf is { } of ? byId.GetValueOrDefault(of) : null);
            onHand += m.Quantity;
            if (m.OccurredAtUtc >= fromUtc)
                shown.Add((m, onHand, average));
        }
        if (!openingTaken)
            (opening, openingAverage) = (onHand, average);

        var sources = await SourcesAsync(shown.Select(s => s.Movement).ToList(), cancellationToken);
        var lines = shown
            .Where(s => type is null || TypeOf(s.Movement.Reason) == type)
            .Select(s =>
            {
                var m = s.Movement;
                var found = sources.GetValueOrDefault((m.SourceId, SourceOf(m.Reason)));
                var source = found ?? new Source(m.SourceId, null, Fallback(m.Reason), null);
                var details = (m.Reason == StockMovementReason.Spoilage || StaffConsumption.Is(m.Reason)) && !m.IsReversal ? m.Note : source.Details;
                if (m.IsReversal)
                    details = details is null ? "Voided · ملغاة" : $"Voided · ملغاة — {details}";
                return new StockCardLine(
                    m.Id, clock.BusinessDateOf(m.OccurredAtUtc), m.OccurredAtUtc, m.Reason, TypeOf(m.Reason), m.IsReversal,
                    SourceOf(m.Reason), source.Id, found is not null, source.Date, source.Reference, details,
                    Quantity(Math.Max(m.Quantity, 0) / size), Quantity(Math.Max(-m.Quantity, 0) / size), Quantity(s.Balance / size),
                    Cost(m.UnitCost * size), m.UnitCost is { } cost ? CostingService.Money(m.Quantity * cost) : null, Cost(s.Average * size),
                    m.RecordedBy ?? source.By);
            })
            .ToList();

        var inPeriod = shown.Select(s => s.Movement).ToList();
        var totalIn = inPeriod.Where(m => m.Quantity > 0).Sum(m => m.Quantity);
        var totalOut = -inPeriod.Where(m => m.Quantity < 0).Sum(m => m.Quantity);
        var closing = opening + totalIn - totalOut;
        return new StockCard(
            material.Id, material.Code, material.Name, material.IsPrepItem, material.Unit, material.PurchaseUnit, size, first, last, type,
            Quantity(opening / size), Cost(openingAverage * size), Quantity(totalIn / size), Quantity(totalOut / size), Quantity(closing / size),
            Cost(average * size), average is { } a ? CostingService.Money(Math.Max(closing, 0) * a) : null,
            Quantity(material.QuantityOnHand / size), Cost(material.AverageCost * size), lines);
    }

    // The average a movement leaves, as the material moves it: a priced delivery or batch averaged in
    // with the stock on the shelf (none below zero); one voided taken back out of it as far as the
    // stock left carries it; any other movement priced at the average then says what that was, which
    // also brings in a price typed in by hand. A reversal of anything else leaves it where it was.
    internal static decimal? AverageAfter(decimal? average, decimal onHand, StockMovement m, StockMovement? original)
    {
        var averaging = m.Reason is StockMovementReason.Purchase or StockMovementReason.ProductionOutput;
        if (m.ReversalOf is null)
        {
            if (m.UnitCost is not { } cost)
                return average;
            if (averaging && m.Quantity > 0)
            {
                var onShelf = Math.Max(onHand, 0);
                return average is { } before && onShelf > 0 ? (onShelf * before + m.Quantity * cost) / (onShelf + m.Quantity) : cost;
            }
            return cost;
        }

        var undone = original?.Quantity ?? -m.Quantity;
        if (!averaging || undone <= 0 || average is not { } now || (original?.UnitCost ?? m.UnitCost) is not { } paid)
            return average;
        var left = onHand - undone;
        if (left <= 0)
            return average;
        var value = Math.Max(onHand, 0) * now - undone * paid;
        return value >= 0 ? value / left : average;
    }

    // What each movement's record says of itself: its number, who or what it was, and its day.
    private sealed record Source(Guid Id, DateOnly? Date, string Reference, string? Details, string? By = null);

    private async Task<Dictionary<(Guid, StockCardSourceKind), Source>> SourcesAsync(IReadOnlyList<StockMovement> movements, CancellationToken cancellationToken)
    {
        var result = new Dictionary<(Guid, StockCardSourceKind), Source>();
        List<Guid> Ids(StockCardSourceKind kind) => movements.Where(m => SourceOf(m.Reason) == kind).Select(m => m.SourceId).Distinct().ToList();

        var invoiceIds = Ids(StockCardSourceKind.PurchaseInvoice);
        if (invoiceIds.Count > 0)
        {
            var invoices = await db.PurchaseInvoices.AsNoTracking()
                .Where(i => invoiceIds.Contains(i.Id))
                .Select(i => new { i.Id, i.SupplierInvoiceNumber, i.SupplierId, i.InvoiceDate, i.PostedAtUtc, i.CreatedAtUtc, i.Status, i.PostedBy })
                .ToListAsync(cancellationToken);
            var supplierIds = invoices.Where(i => i.SupplierId != null).Select(i => i.SupplierId!.Value).Distinct().ToList();
            var suppliers = await db.Suppliers.AsNoTracking().Where(s => supplierIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);
            foreach (var i in invoices)
                result[(i.Id, StockCardSourceKind.PurchaseInvoice)] = new Source(
                    i.Id, i.InvoiceDate ?? clock.BusinessDateOf(i.PostedAtUtc ?? i.CreatedAtUtc),
                    i.SupplierInvoiceNumber is { Length: > 0 } number ? $"Invoice {number} · فاتورة {number}" : "Invoice, no number · فاتورة بدون رقم",
                    (i.SupplierId is { } s ? suppliers.GetValueOrDefault(s) : null) ?? "No supplier · بدون مورد", i.PostedBy);
        }

        var orderIds = Ids(StockCardSourceKind.ProductionOrder);
        if (orderIds.Count > 0)
        {
            var orders = await db.ProductionOrders.AsNoTracking()
                .Where(o => orderIds.Contains(o.Id))
                .Select(o => new { o.Id, o.PrepItemId, o.ProducedQuantity, o.ProducedAtUtc, o.ProducedBy })
                .ToListAsync(cancellationToken);
            var prepIds = orders.Select(o => o.PrepItemId).Distinct().ToList();
            var preps = await db.RawMaterials.AsNoTracking().Where(m => prepIds.Contains(m.Id))
                .ToDictionaryAsync(m => m.Id, m => new { m.Name, m.PurchaseUnit, m.PurchaseUnitSize }, cancellationToken);
            foreach (var o in orders)
            {
                var prep = preps.GetValueOrDefault(o.PrepItemId);
                var made = prep is null ? null : $"{Quantity(o.ProducedQuantity / prep.PurchaseUnitSize):0.###} {prep.PurchaseUnit} of {prep.Name}";
                result[(o.Id, StockCardSourceKind.ProductionOrder)] = new Source(
                    o.Id, clock.BusinessDateOf(o.ProducedAtUtc), "Production batch · تشغيلة إنتاج", made is null ? null : $"Batch: {made}", o.ProducedBy);
            }
        }

        var countIds = Ids(StockCardSourceKind.StockCount);
        if (countIds.Count > 0)
        {
            var counts = await db.StockCounts.AsNoTracking()
                .Where(c => countIds.Contains(c.Id))
                .Select(c => new { c.Id, c.Kind, c.StartedAtUtc, c.PostedAtUtc, c.PostedBy })
                .ToListAsync(cancellationToken);
            foreach (var c in counts)
                result[(c.Id, StockCardSourceKind.StockCount)] = new Source(
                    c.Id, clock.BusinessDateOf(c.PostedAtUtc ?? c.StartedAtUtc),
                    c.Kind == StockCountKind.Opening ? "Opening count · جرد افتتاحي" : "Stock count · جرد", null, c.PostedBy);
        }

        // A sale's movement keeps its receipt line's id; the receipt is what opens.
        var lineIds = Ids(StockCardSourceKind.SalesReceipt);
        if (lineIds.Count > 0)
        {
            var lines = await db.SalesReceipts.AsNoTracking()
                .SelectMany(r => r.Lines.Where(l => lineIds.Contains(l.PublicId)),
                    (r, l) => new { r.Id, r.BusinessDate, r.Source, r.Reference, r.EnteredBy, l.PublicId, l.MenuItemName, l.VariantName, l.Quantity })
                .ToListAsync(cancellationToken);
            foreach (var l in lines)
            {
                var reference = l.Source == SalesSource.DailySummary ? "Daily sales summary · ملخص المبيعات اليومية"
                    : l.Reference is { Length: > 0 } number ? $"Sale {number} · فاتورة بيع {number}" : "Sale · فاتورة بيع";
                var item = l.VariantName is null ? l.MenuItemName : $"{l.MenuItemName} ({l.VariantName})";
                result[(l.PublicId, StockCardSourceKind.SalesReceipt)] = new Source(l.Id, l.BusinessDate, reference, $"{l.Quantity} × {item}", l.EnteredBy);
            }
        }

        foreach (var id in Ids(StockCardSourceKind.Spoilage))
        {
            var first = movements.First(m => m.SourceId == id && (m.Reason == StockMovementReason.Spoilage || StaffConsumption.Is(m.Reason)));
            result[(id, StockCardSourceKind.Spoilage)] = new Source(id, clock.BusinessDateOf(first.OccurredAtUtc), Fallback(first.Reason), first.Note);
        }

        return result;
    }

    // A movement whose record is gone (it should not be): named by why it moved.
    private static string Fallback(StockMovementReason reason) => reason switch
    {
        StockMovementReason.Purchase => "Purchase · مشتريات",
        StockMovementReason.ProductionInput or StockMovementReason.ProductionOutput => "Production batch · تشغيلة إنتاج",
        StockMovementReason.OpeningStock => "Opening count · جرد افتتاحي",
        StockMovementReason.CountAdjustment => "Stock count · جرد",
        StockMovementReason.Spoilage => "Spoilage · تالف",
        StockMovementReason.StaffMeal => "Staff meal · وجبات العاملين",
        StockMovementReason.Hospitality => "Hospitality · ضيافة",
        StockMovementReason.RecipeTasting => "Recipe tasting · تجربة وصفة",
        _ => "Sale · فاتورة بيع",
    };

    private static decimal Quantity(decimal value) => Math.Round(value, 3, MidpointRounding.AwayFromZero);

    private static decimal? Cost(decimal? value) => value is { } v ? Math.Round(v, 4, MidpointRounding.AwayFromZero) : null;
}
```


`IntelligenceController` (`api/costing/intelligence`): التبويبات الخمسة وكل منها بشيت Excel، و `POST orders` (الخطة) و `POST orders/sheet` (ورقة الطلب). وكارتة الصنف في `CostingController`: `GET api/costing/materials/{id}/stock-card?from&to&type` وشيتها `…/stock-card/sheet`، مفتوحة لكل تبويب يعرض الخامة بسعرها أو رصيدها.

> 📄 **`backend/src/Costing.Api/Controllers/IntelligenceController.cs`** — 111 سطر

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Domain.Access;
using Costing.Domain.Recipes;
using Costing.Api.Auth;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// Material & demand intelligence (تحليلات الخامات والطلبيات): purchase price variance and what it does
// to the recipes, the order planner and its sheet, theoretical against actual consumption, and ABC
// with days on hand, menu engineering, and the fully burdened plate cost. Each as a table, and as a workbook (…/sheet). Costs, so a manager's or a cost
// controller's view; nothing here changes anything.
[ApiController]
[Route("api/costing/intelligence")]
[Authorize(Policy = Permissions.InventoryView)]
[CostingTab(CostingTabs.Intelligence)]
public sealed class IntelligenceController(IntelligenceService intelligence, CostingService costing, BurdenedCostService burdened) : ControllerBase
{
    [HttpGet("prices")]
    public Task<PriceVarianceReport> GetPrices([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        intelligence.GetPriceVarianceAsync(from, to, cancellationToken);

    // As the screen filters it: one category, one supplier, the words typed.
    [HttpGet("prices/sheet")]
    public async Task<IActionResult> GetPricesSheet(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] Guid? categoryId, [FromQuery] Guid? supplierId, [FromQuery] string? search,
        CancellationToken cancellationToken)
    {
        var report = await intelligence.GetPriceVarianceAsync(from, to, cancellationToken);
        var words = (search ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var rows = report.Rows
            .Where(r => categoryId is null || r.CategoryId == categoryId)
            .Where(r => supplierId is null || r.SupplierIds.Contains(supplierId.Value))
            .Where(r => words.All(w => $"{r.Material} {r.Code}".Contains(w, StringComparison.OrdinalIgnoreCase)))
            .ToList();
        return File(IntelligenceWorkbooks.PriceVariance(report, rows), ReportWorkbook.ContentType, $"price-variance-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");
    }

    [HttpPost("orders")]
    public Task<OrderPlan> PlanOrder(OrderPlanRequest request, CancellationToken cancellationToken) =>
        intelligence.PlanOrderAsync(request, cancellationToken);

    // The order as approved, by category or by the supplier who sold each last.
    [HttpPost("orders/sheet")]
    public async Task<IActionResult> GetOrderSheet(OrderSheetRequest request, CancellationToken cancellationToken)
    {
        var sheet = await intelligence.OrderSheetAsync(request, cancellationToken);
        return File(IntelligenceWorkbooks.OrderSheet(sheet), ReportWorkbook.ContentType, $"order-{sheet.Today:yyyy-MM-dd}.xlsx");
    }

    [HttpGet("consumption")]
    public Task<ConsumptionReport> GetConsumption([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        intelligence.GetConsumptionAsync(from, to, cancellationToken);

    [HttpGet("consumption/sheet")]
    public async Task<IActionResult> GetConsumptionSheet([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        File(IntelligenceWorkbooks.Consumption(await intelligence.GetConsumptionAsync(from, to, cancellationToken)), ReportWorkbook.ContentType,
            $"consumption-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");

    [HttpGet("abc")]
    public Task<AbcReport> GetAbc([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        intelligence.GetAbcAsync(from, to, cancellationToken);

    [HttpGet("abc/sheet")]
    public async Task<IActionResult> GetAbcSheet([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        File(IntelligenceWorkbooks.Abc(await intelligence.GetAbcAsync(from, to, cancellationToken)), ReportWorkbook.ContentType,
            $"abc-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");

    // Menu engineering (هندسة المنيو والربحية): each dish sold in the period as a Star, a Plowhorse, a
    // Puzzle or a Dog, by its popularity and its contribution margin; in one menu category when asked.
    [HttpGet("menu-engineering")]
    public Task<MenuEngineeringReport> GetMenuEngineering(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] string? category, CancellationToken cancellationToken) =>
        costing.GetMenuEngineeringAsync(from, to, category, cancellationToken);

    [HttpGet("menu-engineering/sheet")]
    public async Task<IActionResult> GetMenuEngineeringSheet(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] string? category, CancellationToken cancellationToken) =>
        File(IntelligenceWorkbooks.MenuEngineering(await costing.GetMenuEngineeringAsync(from, to, category, cancellationToken)), ReportWorkbook.ContentType,
            $"menu-engineering-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");

    // The inflation & pricing simulator (محاكي التضخم والتسعير): every dish, recipe and prep item at
    // hypothetical prices, worked out in memory; nothing is saved.
    [HttpPost("simulate-inflation")]
    public Task<InflationReport> SimulateInflation(InflationScenario scenario, CancellationToken cancellationToken) =>
        costing.SimulateInflationAsync(scenario, cancellationToken);

    [HttpPost("simulate-inflation/sheet")]
    public async Task<IActionResult> SimulateInflationSheet(InflationScenario scenario, CancellationToken cancellationToken) =>
        File(InflationWorkbook.Build(await costing.SimulateInflationAsync(scenario, cancellationToken)), ReportWorkbook.ContentType, "inflation-simulation.xlsx");

    // The fully burdened plate cost (التكلفة الكلية للطبق): each dish's food, its share of the period's
    // labor and overheads, and its true net profit. method: how they are shared (the cost settings'
    // when none); source=Simulated with monthlyLabor and monthlyOverhead tries monthly figures instead
    // of the period's own (the settings' stand-in figures when left out).
    [HttpGet("burdened-costs")]
    public Task<BurdenedCostReport> GetBurdenedCosts(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] OverheadAllocationMethod? method, [FromQuery] PoolSource? source,
        [FromQuery] decimal? monthlyLabor, [FromQuery] decimal? monthlyOverhead, CancellationToken cancellationToken) =>
        burdened.GetAsync(from, to, method, source ?? PoolSource.Actual, monthlyLabor, monthlyOverhead, cancellationToken);

    [HttpGet("burdened-costs/sheet")]
    public async Task<IActionResult> GetBurdenedCostsSheet(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] OverheadAllocationMethod? method, [FromQuery] PoolSource? source,
        [FromQuery] decimal? monthlyLabor, [FromQuery] decimal? monthlyOverhead, CancellationToken cancellationToken) =>
        File(BurdenedCostWorkbook.Build(
                await burdened.GetAsync(from, to, method, source ?? PoolSource.Actual, monthlyLabor, monthlyOverhead, cancellationToken)),
            ReportWorkbook.ContentType, $"burdened-plate-cost-{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}.xlsx");
}
```


### 3.5 تقرير الفروقات بين جردين

> 📄 **`backend/src/Costing.Infrastructure/Reports/VarianceService.cs`** — 280 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockCounts;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

public enum VarianceEvaluation
{
    // Within the tolerance either way: the template's ضمن الحد.
    WithinLimit,

    // More used than the recipes account for, beyond the tolerance (غير مواتٍ): waste, theft,
    // over-portioning, a recipe written too light, or a dish sold with no recipe.
    Unfavourable,

    // Less used than the recipes say (مواتٍ): under-portioning, a recipe written too heavy, or a
    // delivery that was never entered.
    Favourable,

    // A shared cost such as frying oil: used across meals, not by any recipe, so it has no
    // standard to measure against. Shown, but left out of the totals and the evaluation.
    SharedCost,
}

// One material between two counts, in its unit (grams, millilitres, pieces). The weekly
// template's columns (opening, received, damage, standard usage, expected, closing) and the
// actual-vs-standard template's (actual usage, variance, %, value, evaluation) in one row.
public sealed record VarianceRow(
    Guid RawMaterialId,
    string? Code,
    string Material,
    string? Category,
    UnitOfMeasure Unit,
    // How it is bought: a material bought by the gram is counted in grams, not kilograms.
    decimal PurchaseUnitSize,
    decimal Opening,
    decimal Received,
    // Spoilage recorded by hand: the template's damaged raw / packing.
    decimal RawWaste,
    // Dishes voided after the kitchen made them, less ingredients returned by refunds: damaged
    // product / returns.
    decimal ProductWaste,
    // What the sales took by their recipes, the recipe in force at each sale.
    decimal StandardUsage,
    decimal ExpectedClosing,
    decimal Closing,
    // Opening + received − closing.
    decimal ActualUsage,
    // Actual − standard: more than zero is a shortfall. It includes the recorded waste.
    decimal VarianceQuantity,
    decimal? VariancePercent,
    // Expected closing − closing: the part of the variance no record explains.
    decimal UnexplainedQuantity,
    // Average cost per unit at the closing count; null while the material has no price.
    decimal? UnitCost,
    decimal? VarianceValue,
    decimal? UnexplainedValue,
    VarianceEvaluation Evaluation,
    // Staff meals, hospitality and tastings (وجبات العاملين والضيافة): taken on purpose, so out of the
    // unexplained, and not waste.
    decimal StaffMeals = 0);

// Opening: the opening stock (جرد افتتاحي), which the report starts from but never ends at.
public sealed record VarianceCount(Guid Id, DateTime PostedAtUtc, string? PostedBy, bool Opening = false);

public sealed record SoldWithoutStock(string ItemCode, string MenuItem, int Quantity);

public sealed record VarianceReport(
    VarianceCount From,
    VarianceCount To,
    decimal TolerancePercent,
    IReadOnlyList<VarianceRow> Rows,
    int UnfavourableCount,
    decimal NetVarianceValue,
    decimal RecordedWasteValue,
    decimal UnexplainedValue,
    string? LargestRelativeMaterial,
    decimal? LargestRelativePercent,
    // Counted in only one of the two counts, or moved in the period and counted in neither.
    IReadOnlyList<string> NotInBothCounts,
    // Sold with no recipe, so they took nothing from stock: their ingredients show as a shortfall.
    IReadOnlyList<SoldWithoutStock> SoldWithoutStock,
    IReadOnlyList<string> MissingPrices,
    decimal StaffMealsValue = 0);

// One spoilage entry as it was recorded, its lines' worth at the cost then.
public sealed record SpoilageEntry(
    Guid SpoilageId, DateTime RecordedAtUtc, string? RecordedBy, IReadOnlyList<SpoilageEntryLine> Lines, decimal? Value);

public sealed record SpoilageEntryLine(
    Guid RawMaterialId, string Material, UnitOfMeasure Unit, decimal PurchaseUnitSize, decimal Quantity, string? Reason, decimal? Value);

// Pillar 3: actual usage against standard, between two posted stock counts. Actual usage is
// what the counts and the deliveries say left the stores; standard usage is what the recipes
// say the sales should have taken. Both are as purchased (before trimming), as stock is kept,
// so the variance is valued at the average purchase cost, as the template prices it.
public sealed class VarianceService(CostingDbContext db, SalesLedger ledger)
{
    private static readonly StockMovementReason[] Flows =
        [StockMovementReason.Purchase, StockMovementReason.Waste, StockMovementReason.VoidReturn, StockMovementReason.Spoilage,
         StockMovementReason.ProductionInput, StockMovementReason.ProductionOutput, StockMovementReason.StaffMeal, StockMovementReason.Hospitality,
         StockMovementReason.RecipeTasting];

    // Null ids: the last two posted counts; only toId: the count before it.
    public async Task<VarianceReport> GetVarianceAsync(Guid? fromId, Guid? toId, CancellationToken cancellationToken)
    {
        var posted = await db.StockCounts.AsNoTracking()
            .Where(c => c.Status == StockCountStatus.Posted)
            .OrderBy(c => c.PostedAtUtc)
            .Select(c => new VarianceCount(c.Id, c.PostedAtUtc!.Value, c.PostedBy, c.Kind == StockCountKind.Opening))
            .ToListAsync(cancellationToken);

        // Ends at a periodic count: the opening stock is where stock begins, with nothing to measure up to it.
        var to = toId is { } t
            ? posted.Find(c => c.Id == t && !c.Opening) ?? throw new DomainException(
                posted.Any(c => c.Id == t)
                    ? "The report ends at a periodic count: the opening stock is where it starts. · ينتهي التقرير بجرد دوري، والجرد الافتتاحي بدايته."
                    : "Choose a posted count to end at.")
            : posted.LastOrDefault(c => !c.Opening) ?? throw new DomainException(posted.Count == 0
                ? "Post a stock count first: the report measures between two counts."
                : "Post a periodic count: the report measures from the opening stock to it. · رحّل جردًا دوريًا: يُقاس الانحراف من الجرد الافتتاحي إليه.");
        var from = fromId is { } f
            ? posted.Find(c => c.Id == f) ?? throw new DomainException("Choose a posted count to start from.")
            : posted.LastOrDefault(c => c.PostedAtUtc < to.PostedAtUtc)
                ?? throw new DomainException("Post a second stock count: the report measures between two counts.");
        if (from.PostedAtUtc >= to.PostedAtUtc)
            throw new DomainException("The opening count must come before the closing one.");

        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var tolerance = settings.VarianceTolerancePercent;

        var lines = await db.Set<StockCountLine>().AsNoTracking()
            .Where(l => l.StockCountId == from.Id || l.StockCountId == to.Id)
            .ToListAsync(cancellationToken);
        var opening = lines.Where(l => l.StockCountId == from.Id).ToDictionary(l => l.RawMaterialId);
        var closing = lines.Where(l => l.StockCountId == to.Id).ToDictionary(l => l.RawMaterialId);
        var materials = await db.RawMaterials.AsNoTracking().ToDictionaryAsync(m => m.Id, cancellationToken);
        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);
        var shared = (await db.SharedCosts.AsNoTracking().Where(c => c.RawMaterialId != null).Select(c => c.RawMaterialId!.Value)
            .ToListAsync(cancellationToken)).ToHashSet();

        // Deliveries, waste, refunds and spoilage, by when they happened.
        var flows = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc > from.PostedAtUtc && m.OccurredAtUtc <= to.PostedAtUtc && Flows.Contains(m.Reason))
            .GroupBy(m => new { m.RawMaterialId, m.Reason })
            .Select(g => new { g.Key.RawMaterialId, g.Key.Reason, Quantity = g.Sum(m => m.Quantity) })
            .ToListAsync(cancellationToken);
        decimal Flow(Guid id, StockMovementReason reason) =>
            flows.Where(m => m.RawMaterialId == id && m.Reason == reason).Sum(m => m.Quantity);

        // Sales at the till by when their order closed, online ones by when they were paid: a
        // sale's movements are posted just after, so one closed a moment before the count belongs
        // to this period even if posted after it. After the opening count, up to the closing one.
        var sold = (await ledger.GetAsync(from.PostedAtUtc.AddTicks(1), to.PostedAtUtc.AddTicks(1), cancellationToken))
            .SelectMany(o => o.Lines)
            .ToList();
        var soldIds = sold.Select(i => i.PublicId).ToHashSet();
        var saleMovements = (await db.StockMovements.AsNoTracking()
                .Where(m => m.Reason == StockMovementReason.Sale
                    && m.OccurredAtUtc > from.PostedAtUtc.AddDays(-1) && m.OccurredAtUtc <= to.PostedAtUtc.AddDays(1))
                .Select(m => new { m.SourceId, m.RawMaterialId, m.Quantity })
                .ToListAsync(cancellationToken))
            .Where(m => soldIds.Contains(m.SourceId))
            .ToList();
        var standardBy = saleMovements.GroupBy(m => m.RawMaterialId).ToDictionary(g => g.Key, g => -g.Sum(m => m.Quantity));

        var withStock = saleMovements.Select(m => m.SourceId).ToHashSet();
        var soldWithoutStock = sold
            .Where(i => i.OnBill && !withStock.Contains(i.PublicId))
            .GroupBy(i => (i.MenuItemId, i.VariantId))
            .Select(g => new SoldWithoutStock(
                ItemCode(g.Key.MenuItemId, g.Key.VariantId),
                g.First().VariantName is { } size ? $"{g.First().MenuItemName} ({size})" : g.First().MenuItemName,
                g.Sum(i => i.Quantity)))
            .OrderByDescending(s => s.Quantity)
            .ToList();

        var rows = new List<VarianceRow>();
        foreach (var id in opening.Keys.Intersect(closing.Keys))
        {
            var material = materials[id];
            var open = opening[id].CountedQuantity;
            var close = closing[id].CountedQuantity;
            // Bought, or for a prep item made: both come into stock at a cost.
            var received = Flow(id, StockMovementReason.Purchase) + Flow(id, StockMovementReason.ProductionOutput);
            var rawWaste = -Flow(id, StockMovementReason.Spoilage);
            var productWaste = -(Flow(id, StockMovementReason.Waste) + Flow(id, StockMovementReason.VoidReturn));
            var staffMeals = -StaffConsumption.Reasons.Sum(r => Flow(id, r));
            // What the sales took by their recipes, and what production took by the prep items'.
            var standard = standardBy.GetValueOrDefault(id) - Flow(id, StockMovementReason.ProductionInput);
            var expected = open + received - rawWaste - productWaste - staffMeals - standard;
            var actual = open + received - close;
            var variance = actual - standard;
            var unexplained = expected - close;
            decimal? percent = standard > 0 ? Percent(variance / standard) : null;
            var unitCost = closing[id].UnitCost ?? opening[id].UnitCost ?? material.AverageCost;

            var evaluation = shared.Contains(id) && standard == 0 ? VarianceEvaluation.SharedCost
                : percent is { } p
                ? p > tolerance ? VarianceEvaluation.Unfavourable : p < -tolerance ? VarianceEvaluation.Favourable : VarianceEvaluation.WithinLimit
                // Nothing sold that uses it: any use at all is unexplained by sales.
                : variance > 0 ? VarianceEvaluation.Unfavourable : variance < 0 ? VarianceEvaluation.Favourable : VarianceEvaluation.WithinLimit;

            rows.Add(new VarianceRow(
                id, material.Code, material.Name, categories.GetValueOrDefault(material.CategoryId), material.Unit, material.PurchaseUnitSize,
                Quantity(open), Quantity(received), Quantity(rawWaste), Quantity(productWaste), Quantity(standard),
                Quantity(expected), Quantity(close), Quantity(actual), Quantity(variance), percent, Quantity(unexplained),
                unitCost, Money(variance * unitCost), Money(unexplained * unitCost), evaluation, Quantity(staffMeals)));
        }

        rows = rows
            .OrderBy(r => r.Evaluation == VarianceEvaluation.SharedCost)
            .ThenByDescending(r => Math.Abs(r.VarianceValue ?? 0))
            .ThenByDescending(r => Math.Abs(r.VariancePercent ?? 0))
            .ThenBy(r => r.Material)
            .ToList();

        var moved = flows.Select(m => m.RawMaterialId).Concat(standardBy.Keys);
        var notInBoth = opening.Keys.Union(closing.Keys).Union(moved)
            .Where(id => !(opening.ContainsKey(id) && closing.ContainsKey(id)))
            .Where(materials.ContainsKey)
            .Select(id => materials[id].Name)
            .Order()
            .ToList();

        // Shared costs are in the table but not the totals: they have no standard to fall short of.
        var measured = rows.Where(r => r.Evaluation != VarianceEvaluation.SharedCost).ToList();
        var largest = measured.Where(r => r.VariancePercent is not null).MaxBy(r => Math.Abs(r.VariancePercent!.Value));
        return new VarianceReport(
            from, to, tolerance, rows,
            measured.Count(r => r.Evaluation == VarianceEvaluation.Unfavourable),
            measured.Sum(r => r.VarianceValue ?? 0),
            Money(measured.Sum(r => (r.RawWaste + r.ProductWaste) * (r.UnitCost ?? 0))),
            measured.Sum(r => r.UnexplainedValue ?? 0),
            largest?.Material, largest?.VariancePercent,
            notInBoth, soldWithoutStock,
            rows.Where(r => r.UnitCost is null).Select(r => r.Material).ToList(),
            Money(measured.Sum(r => r.StaffMeals * (r.UnitCost ?? 0))));
    }

    // Spoilage recorded in the period, newest first. An entry voided since (a manager approved
    // its deletion, and its stock went back) is not listed; the approvals keep its history.
    public async Task<IReadOnlyList<SpoilageEntry>> GetSpoilageAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var movements = await db.StockMovements.AsNoTracking()
            .Where(m => m.Reason == StockMovementReason.Spoilage && m.ReversalOf == null && m.OccurredAtUtc >= fromUtc && m.OccurredAtUtc < toUtc)
            .ToListAsync(cancellationToken);
        var entries = movements.Select(m => m.SourceId).Distinct().ToList();
        var voided = await db.StockMovements.AsNoTracking()
            .Where(m => m.Reason == StockMovementReason.Spoilage && m.ReversalOf != null && entries.Contains(m.SourceId))
            .Select(m => m.SourceId)
            .Distinct()
            .ToListAsync(cancellationToken);
        var materials = await db.RawMaterials.AsNoTracking().ToDictionaryAsync(m => m.Id, cancellationToken);

        return movements
            .Where(m => !voided.Contains(m.SourceId))
            .GroupBy(m => m.SourceId)
            .Select(g =>
            {
                var entryLines = g
                    .Select(m => new SpoilageEntryLine(
                        m.RawMaterialId, materials[m.RawMaterialId].Name, materials[m.RawMaterialId].Unit,
                        materials[m.RawMaterialId].PurchaseUnitSize, -m.Quantity, m.Note, Money(-m.Quantity * m.UnitCost)))
                    .OrderBy(l => l.Material)
                    .ToList();
                return new SpoilageEntry(
                    g.Key, g.Min(m => m.OccurredAtUtc), g.First().RecordedBy, entryLines,
                    entryLines.Any(l => l.Value is null) ? null : entryLines.Sum(l => l.Value));
            })
            .OrderByDescending(e => e.RecordedAtUtc)
            .ToList();
    }

    private static decimal Quantity(decimal value) => Math.Round(value, 3, MidpointRounding.AwayFromZero);
}
```


## 4. الـ KPIs وقائمة الدخل ونقطة التعادل

### 4.1 قائمة الدخل الشهرية (`MonthStatement`)

```text
الإيراد            = صافي التوريد (كاش + فيزا قبل الضريبة)، مقسوم طعام/مشروبات بنسبة قيمة المبيعات بالمنيو
تكلفة المبيعات      = تكلفة الوصفات النظرية + هالك المطبخ + التالف + فروقات الجرد الدوري
مجمل الربح          = الإيراد − تكلفة المبيعات
الأجور              = تكلفة عمالة المسير المعتمد للشهر، وإلا الرواتب المصروفة له
المصروفات التشغيلية = الأجور + القابلة للتحكم + الإشغال + الثابتة الأخرى + الضيافة (المدخلة شهريًا + فواتير المصروفات بفئاتها)
EBITDA              = مجمل الربح − المصروفات التشغيلية
الإهلاك             = إهلاك سجل الأصول للشهر + أي إهلاك مدخل يدويًا
صافي الربح          = EBITDA − الفوائد − الإهلاك ± أرباح/خسائر استبعاد الأصول في الشهر
```

`ProfitAndLoss.Of(report)` يعيد نفس القائمة سطرًا سطرًا لـ `GET /api/costing/reports/pnl`.

> 📄 **`backend/src/Costing.Infrastructure/Reports/ProfitAndLoss.cs`** — 86 سطر

```csharp
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// A line of the profit and loss: its amount and its share of the revenue. A total (IsTotal) sums
// what is above it; Level 1 is a line within a section.
public sealed record PnlLine(string Key, string En, string Ar, decimal? Amount, decimal? PercentOfRevenue, int Level = 0, bool IsTotal = false);

// The month's profit and loss (قائمة الدخل), from its KPI statement (MonthStatement):
//
//   Revenue (net sales, before tax)
// − Cost of sales (the recipes' cost of what was sold, and the losses)
// = Gross profit (مجمل الربح)
// − Operating expenses: wages and benefits, running costs, occupation, other fixed costs, hospitality
// = EBITDA (الربح التشغيلي قبل الفوائد والضرائب والإهلاك)
// − Interest
// − Depreciation (إهلاك الأصول الثابتة): the fixed assets register's, and any entered for the month
// ± Gains and losses on assets disposed of or sold
// = Net profit (صافي الربح النهائي)
//
// A fixed asset bought (CAPEX) is never on it: its cost left the safe or the bank, and comes here a
// month at a time as depreciation. EBITDA and the net profit are null until the month's wages are in
// (Missing says so): without them they would flatter.
public sealed record ProfitAndLoss(
    int Year,
    int Month,
    DateOnly From,
    DateOnly To,
    decimal Revenue,
    decimal CostOfSales,
    decimal GrossProfit,
    decimal OperatingExpenses,
    decimal? Ebitda,
    decimal Interest,
    decimal AssetDepreciation,
    decimal EnteredDepreciation,
    decimal Depreciation,
    decimal DisposalGainOrLoss,
    decimal? NetProfit,
    decimal? GrossMarginPercent,
    decimal? EbitdaMarginPercent,
    decimal? NetMarginPercent,
    IReadOnlyList<PnlLine> Lines,
    string? Missing)
{
    public static ProfitAndLoss Of(KpiReport report)
    {
        var s = report.Statement;
        decimal? Share(decimal? part) => part is { } p && s.Revenue > 0 ? Percent(p / s.Revenue) : null;
        PnlLine Line(string key, string en, string ar, decimal? amount, int level = 0, bool total = false) =>
            new(key, en, ar, Money(amount), Share(amount), level, total);

        var wages = s.WagesAndBenefits is null && s.LoggedWages == 0 ? (decimal?)null : (s.WagesAndBenefits ?? 0) + s.LoggedWages + s.StaffMeals;
        var interest = s.Interest ?? 0;
        var entered = s.Depreciation ?? 0;
        var lines = new List<PnlLine>
        {
            Line("revenue", "Revenue (net sales)", "الإيرادات (صافي المبيعات)", s.Revenue, total: true),
            Line("foodSales", "Food", "مأكولات", s.FoodSales, 1),
            Line("beverageSales", "Beverages", "مشروبات", s.BeverageSales, 1),
            Line("costOfSales", "Cost of sales", "تكلفة المبيعات", s.CostOfSales, total: true),
            Line("recipeCost", "Recipes' cost of what was sold", "تكلفة الوصفات المباعة", s.FoodRecipeCost + s.BeverageRecipeCost, 1),
            Line("losses", "Waste, spoilage and count differences", "الهالك والتالف وفروق الجرد", s.KitchenWaste + s.Spoilage + s.CountDifferences, 1),
            Line("grossProfit", "Gross profit", "مجمل الربح", s.GrossProfit, total: true),
            Line("operatingExpenses", "Operating expenses", "المصروفات التشغيلية", s.OperatingExpenses, total: true),
            Line("wages", "Wages & benefits", "الأجور والمزايا", wages, 1),
            Line("controllable", "Utilities & running costs", "المرافق ومصاريف التشغيل", (s.OtherControllableCosts ?? 0) + s.LoggedControllableCosts, 1),
            Line("occupation", "Rent & occupation", "الإيجار والمكان", (s.OccupationCost ?? 0) + s.LoggedOccupationCost, 1),
            Line("otherFixed", "Other fixed costs", "مصاريف ثابتة أخرى", s.LoggedOtherFixedCosts, 1),
            Line("hospitality", "Hospitality & recipe tastings", "الضيافة وتجارب الوصفات", s.Hospitality + s.RecipeTasting, 1),
            Line("ebitda", "EBITDA", "الربح التشغيلي قبل الفوائد والضرائب والإهلاك", s.Ebitda, total: true),
            Line("interest", "Interest", "الفوائد", interest),
            Line("depreciation", "Depreciation expense", "إهلاك الأصول الثابتة", s.DepreciationExpense),
            Line("assetDepreciation", "Fixed assets register", "سجل الأصول الثابتة", s.AssetDepreciation, 1),
            Line("enteredDepreciation", "Entered for the month", "مدخل للشهر", entered, 1),
            Line("disposals", "Gain / (loss) on asset disposals", "أرباح / (خسائر) استبعاد الأصول", s.DisposalGainOrLoss),
            Line("netProfit", "Net profit", "صافي الربح النهائي", s.NetProfit, total: true),
        };

        return new ProfitAndLoss(
            report.Year, report.Month, report.From, report.To, s.Revenue, s.CostOfSales, s.GrossProfit, s.OperatingExpenses, s.Ebitda, Money(interest),
            s.AssetDepreciation, Money(entered), s.DepreciationExpense, s.DisposalGainOrLoss, s.NetProfit,
            Share(s.GrossProfit), Share(s.Ebitda), Share(s.NetProfit), lines,
            s.Ebitda is null ? "Enter the month's wages and benefits: without them EBITDA and the net profit would flatter. · أدخل أجور الشهر." : null);
    }
}
```


### 4.2 المؤشرات (`Kpi`)

| المفتاح | المعادلة | المدى الصحي (من القالب) |
| --- | --- | --- |
| `FoodCost` | تكلفة الطعام ÷ إيراد الطعام | حسب القالب |
| `BeverageCost` | تكلفة المشروبات ÷ إيرادها | |
| `LabourCost` | الأجور ÷ الإيراد | 25-35% |
| `GrossProfitMargin` | مجمل الربح ÷ الإيراد | |
| `NetProfitMargin` | صافي الربح ÷ الإيراد | |
| `AverageCheck` | الإيراد ÷ عدد الفواتير | (يظهر "ناقص" في نموذج الملخص اليومي لأنه بلا فواتير) |
| `SalesPerLabourHour` | الإيراد ÷ ساعات العمل المدخلة | |

كل مؤشر بحالته (`KpiStatus`: صحي، خارج المدى، ناقص) **وسبب النقص** ("أدخل توريد الشهر"). و **Prime Cost** (طعام + عمالة) يُقرأ من `FoodCost` + `LabourCost`؛ ليس مؤشرًا منفصلًا في الكود.

> 📄 **`backend/src/Costing.Infrastructure/Reports/KpiService.cs`** — 388 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Treasury;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Sales;
using Costing.Domain.Categories;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

public enum KpiStatus
{
    // Within the template's healthy range.
    Healthy,
    Above,
    Below,

    // The template gives no range: it depends on the kind of restaurant.
    NoRange,

    // A figure it needs has not been entered (wages, hours) or does not exist (no drinks sold).
    Missing,
}

// One indicator of the template. Value is a percentage, or money for the average check and sales
// per labour hour. HighIsBad says which side of the range is the worry: above for a cost %,
// below for a margin.
public sealed record Kpi(string Key, decimal? Value, decimal? HealthyFrom, decimal? HealthyTo, bool HighIsBad, KpiStatus Status, string? Missing);

// The month as an income statement, the KPIs' ground. Revenue is the month's net sales: its takings
// as each day's Z report gave them, cash and card, less the tax collected in them, which is owed to
// the tax authority and never the restaurant's (Gross takings = Net sales + Tax). Split between
// food and drinks as the month's sales summaries are, at the menu's prices.
public sealed record MonthStatement(
    decimal FoodSales,
    decimal BeverageSales,
    decimal DeliveryFees,
    decimal Revenue,
    int PaidOrders,
    // What the sales took by their recipes, at cost when sold, shared costs such as frying oil included.
    decimal FoodRecipeCost,
    decimal BeverageRecipeCost,
    // Kitchen voids less refund returns, spoilage, and what counts found missing (or over).
    decimal KitchenWaste,
    decimal Spoilage,
    decimal CountDifferences,
    decimal CostOfSales,
    decimal GrossProfit,
    // As entered for the month: wages, and what is paid without a purchase invoice.
    decimal? WagesAndBenefits,
    decimal? OtherControllableCosts,
    decimal? OccupationCost,
    decimal? Interest,
    decimal? Depreciation,
    // Null until the wages are in: without them a net profit would flatter.
    decimal? NetProfit,
    // Expense items on the month's posted purchase invoices, on the line each category says,
    // added to what is entered above; and each category's part.
    decimal LoggedControllableCosts = 0,
    decimal LoggedOccupationCost = 0,
    decimal LoggedOtherFixedCosts = 0,
    IReadOnlyList<LoggedExpense>? LoggedExpenses = null,
    // Wages paid as expenses (vouchers, invoices under a Wages category) and the finalized payroll's
    // wages, added to the wages entered.
    decimal LoggedWages = 0,
    // Every overhead: wages, controllable, occupation, other fixed, interest and depreciation.
    decimal TotalExpenses = 0,
    // Consumable assets broken in the month (Costing → Waste's breakage), at their cost. Said, not
    // counted again: what they cost was counted when they were bought, as an expense.
    decimal Breakage = 0,
    // The month's takings: cash and card before tax, all that was collected with the tax on them, the
    // tax (a liability, not revenue), the voids and refunds said, and how many days' takings are entered.
    decimal CashTakings = 0,
    decimal CardTakings = 0,
    decimal GrossTakings = 0,
    decimal TaxCollected = 0,
    decimal Voids = 0,
    int TakingsDays = 0,
    // What the month's sales summaries come to at the menu's prices, before tax.
    decimal SalesAtMenuPrices = 0,
    // Taken from stock on purpose, at the cost then (وجبات العاملين والضيافة): staff meals, a benefit
    // of the staff, in the wages and benefits once the wages are known; hospitality and recipe
    // tastings, costs of their own in the total expenses. None of them is food cost or a loss.
    decimal StaffMeals = 0,
    decimal Hospitality = 0,
    decimal RecipeTasting = 0,
    // The P&L below the gross profit (ProfitAndLoss): what it costs to run the place, every overhead
    // but the interest and the depreciation; and what is left, EBITDA, null until the wages are in.
    decimal OperatingExpenses = 0,
    decimal? Ebitda = null,
    // The fixed assets register's straight-line depreciation for the month (FixedAssetService), on top
    // of any entered above; all of it; and the gains less the losses on the assets disposed of or sold
    // in the month, what they brought in less what was left of their cost.
    decimal AssetDepreciation = 0,
    decimal DepreciationExpense = 0,
    decimal DisposalGainOrLoss = 0);

public sealed record MonthlyExpensesDto(
    decimal? WagesAndBenefits,
    decimal? LabourHours,
    decimal? OtherControllableCosts,
    decimal? OccupationCost,
    decimal? Interest,
    decimal? Depreciation,
    DateTime? UpdatedAtUtc = null,
    string? UpdatedBy = null);

// The template's item profitability: selling price − ingredient cost, over what was sold.
public sealed record ItemProfit(
    string ItemCode, string MenuItem, string? MenuItemAr, string Category, bool Beverage, decimal QuantitySold,
    decimal NetSales, decimal? Cost, decimal? Profit, decimal? ProfitPerUnit, decimal? MarginPercent);

public sealed record KpiReport(
    int Year,
    int Month,
    DateOnly From,
    DateOnly To,
    IReadOnlyList<string> BeverageCategories,
    MonthStatement Statement,
    MonthlyExpensesDto Expenses,
    IReadOnlyList<Kpi> Kpis,
    IReadOnlyList<ItemProfit> Items,
    // Sold with no recipe: in the sales at no ingredient cost, so the cost % reads low.
    int ItemsWithoutRecipe,
    decimal SalesWithoutRecipe,
    // What the month's discounts and promos did to the margin.
    DiscountImpact? Discounts = null);

// Promos and discounts against the margin (أثر الخصومات وتآكل الهامش), from the month's takings:
//
//   Standard gross revenue = net sales + discounts        (what the menu prices would have brought)
//   Actual net revenue     = net sales                    (the cash and card collected, before tax)
//   Standard food cost %   = theoretical cost ÷ standard gross revenue × 100
//   Actual food cost %     = theoretical cost ÷ actual net revenue × 100
//   Margin erosion         = actual food cost % − standard food cost %, in points
//
// The theoretical cost is the recipes' cost of what was sold (food and drinks). Reasons: each with
// what it took off and on how many bills, the largest first; a voided day's taken back out.
public sealed record DiscountImpact(
    decimal Discounts,
    decimal ActualNetRevenue,
    decimal StandardGrossRevenue,
    decimal? DiscountSharePercent,
    decimal TheoreticalCost,
    decimal? StandardFoodCostPercent,
    decimal? ActualFoodCostPercent,
    decimal? ErosionPoints,
    IReadOnlyList<DiscountReason> Reasons);

// Pillar 4: the template's financial KPIs for a business month. Sales and recipe costs come
// from the till; losses from the stock ledger; wages, hours and overheads from what the manager
// enters for the month.
public sealed class KpiService(
    CostingDbContext db, IBusinessCalendar clock, CostingService costing, SalesLedger ledger, PurchaseSpendingService spending, FixedAssetService fixedAssets)
{
    // The template's healthy ranges.
    private static readonly (decimal From, decimal To) FoodCostRange = (28, 35);
    private static readonly (decimal From, decimal To) BeverageCostRange = (20, 25);
    private static readonly (decimal From, decimal To) LabourCostRange = (25, 35);
    private static readonly (decimal From, decimal To) GrossMarginRange = (60, 70);
    private static readonly (decimal From, decimal To) NetMarginRange = (5, 15);

    private static readonly StockMovementReason[] Losses =
        [StockMovementReason.Waste, StockMovementReason.VoidReturn, StockMovementReason.Spoilage, StockMovementReason.CountAdjustment];

    public async Task<KpiReport> GetAsync(int year, int month, CancellationToken cancellationToken)
    {
        // Checks the month, and gives what each dish sold and what its recipes cost.
        var theoretical = await costing.GetTheoreticalCostAsync(year, month, cancellationToken);
        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var beverages = settings.BeverageCategories.ToHashSet(StringComparer.OrdinalIgnoreCase);
        bool IsBeverage(string? category) => category is not null && beverages.Contains(category);

        var (from, _) = clock.Bounds(theoretical.From);
        var (_, to) = clock.Bounds(theoretical.To);

        // What was sold, at the menu's prices (a bill entered as printed: what it charged), less each
        // bill's promo discount shared over its lines by value, before VAT: how the revenue is
        // split between food and drinks.
        var orders = await ledger.GetAsync(from, to, cancellationToken);
        var categoryOf = await db.MenuItems.AsNoTracking().IgnoreQueryFilters()
            .ToDictionaryAsync(m => m.Id, m => m.Category, cancellationToken);
        decimal food = 0, drinks = 0, deliveryFees = 0;
        var paidOrders = 0;
        foreach (var order in orders)
        {
            var lines = order.Lines.Where(l => l.OnBill).ToList();
            if (lines.Count == 0)
                continue;
            paidOrders++;
            var billed = order.BilledSubtotal;
            var kept = billed > 0 ? 1 - Math.Min(order.DiscountAmount, billed) / billed : 1;
            foreach (var line in lines)
            {
                var revenue = line.LineTotal * kept;
                if (IsBeverage(categoryOf.GetValueOrDefault(line.MenuItemId)))
                    drinks += revenue;
                else
                    food += revenue;
            }
            deliveryFees += order.DeliveryFee;
        }
        var soldAtMenuPrices = food + drinks + deliveryFees;

        // Revenue: the month's net sales, the cash and card each day's Z report gave before the tax
        // collected on them, which is owed, never revenue. A voided day nets out with its reversal.
        var takings = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.RevenueTransfer && t.RevenueDate >= theoretical.From && t.RevenueDate <= theoretical.To)
            .ToListAsync(cancellationToken);
        var revenueTotal = takings.Sum(t => t.NetAmount);
        var takingsDays = takings.Where(t => !t.IsReversal && !t.IsVoided).Select(t => t.RevenueDate).Distinct().Count();
        (food, drinks) = food + drinks > 0
            ? (revenueTotal * food / (food + drinks), revenueTotal - revenueTotal * food / (food + drinks))
            : (revenueTotal, 0m);
        var noTakings = revenueTotal == 0 ? "Enter the month's takings on Financials. · أدخل إيراد الشهر في الماليات." : null;

        var foodRecipe = theoretical.Rows.Where(r => !IsBeverage(r.Category)).Sum(r => r.TheoreticalCost);
        var drinksRecipe = theoretical.Rows.Where(r => IsBeverage(r.Category)).Sum(r => r.TheoreticalCost);

        // Losses from the ledger, valued at the cost when each happened. Shared-cost materials are
        // left out: their month is already in the recipe cost, as the shared cost per meal.
        var sharedMaterials = await db.SharedCosts.AsNoTracking()
            .Where(c => c.RawMaterialId != null).Select(c => c.RawMaterialId!.Value).ToListAsync(cancellationToken);
        var losses = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc >= from && m.OccurredAtUtc < to && Losses.Contains(m.Reason)
                && !sharedMaterials.Contains(m.RawMaterialId) && m.UnitCost != null)
            .GroupBy(m => m.Reason)
            .Select(g => new { Reason = g.Key, Value = g.Sum(m => -m.Quantity * m.UnitCost!.Value) })
            .ToListAsync(cancellationToken);
        decimal Loss(params StockMovementReason[] reasons) => Money(losses.Where(l => reasons.Contains(l.Reason)).Sum(l => l.Value));
        var kitchenWaste = Loss(StockMovementReason.Waste, StockMovementReason.VoidReturn);
        var spoilage = Loss(StockMovementReason.Spoilage);
        var countDifferences = Loss(StockMovementReason.CountAdjustment);
        var lossTotal = kitchenWaste + spoilage + countDifferences;

        var costOfSales = foodRecipe + drinksRecipe + lossTotal;
        var grossProfit = revenueTotal - costOfSales;

        var expenses = await db.MonthlyExpenses.AsNoTracking().SingleOrDefaultAsync(e => e.Year == year && e.Month == month, cancellationToken);
        // The month's expense invoices and vouchers, on top of what is entered: an electricity bill
        // logged as a purchase, or salaries paid by voucher, are not typed in again.
        var logged = await spending.LoggedExpensesAsync(theoretical.From, theoretical.To, cancellationToken);
        decimal Logged(ExpenseLine line) => Money(logged.Where(e => e.ExpenseLine == line).Sum(e => e.Amount));
        var (loggedControllable, loggedOccupation, loggedOtherFixed, loggedWages) =
            (Logged(ExpenseLine.Controllable), Logged(ExpenseLine.Occupation), Logged(ExpenseLine.OtherFixed), Logged(ExpenseLine.Wages));
        // The month's labor: the payroll HR approved for it, when HR sent one (its labor cost: the
        // wages and what was added, less the penalties, whether paid yet or not); otherwise the
        // month's salaries paid from the safe (صرف راتب), by the payroll month they are for, a voided
        // one netted out by its reversal. Advances are settled against pay, not counted again.
        var payrollMonth = new DateOnly(year, month, 1);
        if (await db.PayrollRuns.AsNoTracking().Where(r => r.Period == payrollMonth).Select(r => (decimal?)r.LaborCost).SingleOrDefaultAsync(cancellationToken)
            is { } payrollLabor)
            loggedWages += payrollLabor;
        else
            loggedWages += Money(-await db.SafeTransactions.AsNoTracking()
                .Where(t => t.Kind == SafeTransactionKind.SalaryPayment && t.PayrollMonth == payrollMonth)
                .SumAsync(t => t.Amount, cancellationToken));
        // Staff meals, hospitality and tastings, at what they cost when taken.
        var consumed = await db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAtUtc >= from && m.OccurredAtUtc < to && StaffConsumption.Reasons.Contains(m.Reason) && m.UnitCost != null)
            .GroupBy(m => m.Reason)
            .Select(g => new { Reason = g.Key, Value = g.Sum(m => -m.Quantity * m.UnitCost!.Value) })
            .ToListAsync(cancellationToken);
        decimal Consumed(StockMovementReason reason) => Money(consumed.Where(c => c.Reason == reason).Sum(c => c.Value));
        var (staffMeals, hospitality, tasting) =
            (Consumed(StockMovementReason.StaffMeal), Consumed(StockMovementReason.Hospitality), Consumed(StockMovementReason.RecipeTasting));

        // Known once entered or paid: wages as entered plus wages paid as expenses, with the staff's meals.
        decimal? wages = expenses?.WagesAndBenefits is null && loggedWages == 0 ? null : (expenses?.WagesAndBenefits ?? 0) + loggedWages + staffMeals;
        // Gross profit − operating expenses = EBITDA; − interest − depreciation ± disposals = net profit.
        // A fixed asset bought is never an operating expense: its cost left the safe or the bank, and
        // comes here a month at a time as depreciation (FixedAsset).
        var operating = (wages ?? 0) + (expenses?.OtherControllableCosts ?? 0) + (expenses?.OccupationCost ?? 0)
            + loggedControllable + loggedOccupation + loggedOtherFixed + hospitality + tasting;
        var assetMonth = await fixedAssets.MonthAsync(theoretical.From, cancellationToken);
        var depreciation = (expenses?.Depreciation ?? 0) + assetMonth.Depreciation;
        var totalExpenses = operating + (expenses?.Interest ?? 0) + depreciation;
        decimal? ebitda = wages is not null ? grossProfit - operating : null;
        decimal? netProfit = ebitda is { } e ? e - (expenses?.Interest ?? 0) - depreciation + assetMonth.DisposalGainOrLoss : null;
        var breakage = Money(await db.BreakageEntries.AsNoTracking()
            .Where(b => b.BusinessDate >= theoretical.From && b.BusinessDate <= theoretical.To && b.VoidedAtUtc == null)
            .SumAsync(b => b.Cost, cancellationToken));

        decimal? Share(decimal part, decimal whole) => whole > 0 ? Percent(part / whole) : null;
        var kpis = new List<Kpi>
        {
            // Losses are counted against food: the stock they come from is mostly the kitchen's.
            Ranged("FoodCost", Share(foodRecipe + lossTotal, food), FoodCostRange, highIsBad: true,
                noTakings ?? (food > 0 ? null : "No food was sold this month.")),
            Ranged("BeverageCost", Share(drinksRecipe, drinks), BeverageCostRange, highIsBad: true,
                beverages.Count == 0 ? "Mark the drinks categories in Settings." : noTakings ?? (drinks > 0 ? null : "No drinks were sold this month.")),
            Ranged("LabourCost", wages is { } wage ? Share(wage, revenueTotal) : null, LabourCostRange, highIsBad: true,
                wages is null ? "Enter the month's wages and benefits." : noTakings),
            // Sales are entered as each day's totals: there are no bills to average.
            Unranged("AverageCheck", null, "Sales are entered as daily totals, not bills. · المبيعات تُسجل إجماليًا يوميًا."),
            Unranged("SalesPerLabourHour", expenses?.LabourHours is > 0 and var hours ? Money(revenueTotal / hours) : null,
                expenses?.LabourHours is > 0 ? null : "Enter the month's labour hours."),
            Ranged("GrossProfitMargin", Share(grossProfit, revenueTotal), GrossMarginRange, highIsBad: false, noTakings),
            Ranged("NetProfitMargin", netProfit is { } net ? Share(net, revenueTotal) : null, NetMarginRange, highIsBad: false,
                wages is null ? "Enter the month's wages and overheads." : null),
        };

        var items = theoretical.Rows
            .Select(r =>
            {
                var costed = r.Status != CostStatus.NoRecipe;
                decimal? profit = costed ? r.NetSales - r.TheoreticalCost : null;
                return new ItemProfit(
                    r.ItemCode, r.MenuItem, r.MenuItemAr, r.Category, IsBeverage(r.Category), r.QuantitySold, r.NetSales,
                    costed ? r.TheoreticalCost : null, profit, profit is { } p && r.QuantitySold > 0 ? Money(p / r.QuantitySold) : null,
                    profit is { } q && r.NetSales > 0 ? Percent(q / r.NetSales) : null);
            })
            .OrderByDescending(i => i.Profit ?? decimal.MinValue)
            .ThenByDescending(i => i.NetSales)
            .ToList();
        var withoutRecipe = theoretical.Rows.Where(r => r.Status == CostStatus.NoRecipe).ToList();

        return new KpiReport(
            year, month, theoretical.From, theoretical.To, settings.BeverageCategories,
            new MonthStatement(
                Money(food), Money(drinks), 0, Money(revenueTotal), paidOrders,
                Money(foodRecipe), Money(drinksRecipe), kitchenWaste, spoilage, countDifferences,
                Money(costOfSales), Money(grossProfit),
                expenses?.WagesAndBenefits, expenses?.OtherControllableCosts, expenses?.OccupationCost, expenses?.Interest, expenses?.Depreciation,
                Money(netProfit), loggedControllable, loggedOccupation, loggedOtherFixed, logged, loggedWages, Money(totalExpenses), breakage,
                Money(takings.Sum(t => t.GrossAmount ?? t.Amount)), Money(takings.Sum(t => t.CardAmount)), Money(takings.Sum(t => t.TakingsTotal)),
                Money(takings.Sum(t => t.TaxAmount)), Money(takings.Sum(t => t.VoidsAmount)),
                takingsDays, Money(soldAtMenuPrices), staffMeals, hospitality, tasting,
                Money(operating), Money(ebitda), assetMonth.Depreciation, Money(depreciation), assetMonth.DisposalGainOrLoss),
            ToDto(expenses), kpis, items,
            withoutRecipe.Count, withoutRecipe.Sum(r => r.NetSales),
            Erosion(takings, Money(revenueTotal), Money(foodRecipe + drinksRecipe)));
    }

    // The month's discounts against its revenue and its theoretical cost (DiscountImpact).
    internal static DiscountImpact Erosion(IReadOnlyCollection<SafeTransaction> takings, decimal netRevenue, decimal theoreticalCost)
    {
        var discounts = Money(takings.Sum(t => t.DiscountsAmount));
        var standard = Money(netRevenue + discounts);
        decimal? Share(decimal part, decimal whole) => whole > 0 ? Percent(part / whole) : null;
        var (standardPercent, actualPercent) = (Share(theoreticalCost, standard), Share(theoreticalCost, netRevenue));
        var reasons = takings.SelectMany(t => t.DiscountReasons)
            .GroupBy(r => r.Reason.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new DiscountReason(g.First().Reason.Trim(), Money(g.Sum(r => r.Amount)), g.Sum(r => r.Count)))
            .Where(r => r.Amount != 0 || r.Count != 0)
            .OrderByDescending(r => r.Amount).ThenByDescending(r => r.Count).ThenBy(r => r.Reason)
            .ToList();
        return new DiscountImpact(
            discounts, netRevenue, standard, Share(discounts, standard), theoreticalCost, standardPercent, actualPercent,
            actualPercent is { } actual && standardPercent is { } std ? Math.Round(actual - std, 1, MidpointRounding.AwayFromZero) : null,
            reasons);
    }

    public async Task<MonthlyExpensesDto> SaveExpensesAsync(int year, int month, MonthlyExpensesDto request, string? by, CancellationToken cancellationToken)
    {
        var row = await db.MonthlyExpenses.SingleOrDefaultAsync(e => e.Year == year && e.Month == month, cancellationToken);
        if (row is null)
            db.MonthlyExpenses.Add(row = new MonthlyExpenses { Year = year, Month = month });
        row.WagesAndBenefits = request.WagesAndBenefits;
        row.LabourHours = request.LabourHours;
        row.OtherControllableCosts = request.OtherControllableCosts;
        row.OccupationCost = request.OccupationCost;
        row.Interest = request.Interest;
        row.Depreciation = request.Depreciation;
        row.UpdatedAtUtc = DateTime.UtcNow;
        row.UpdatedBy = by;
        row.Validate();
        await db.SaveChangesAsync(cancellationToken);
        return ToDto(row);
    }

    private static MonthlyExpensesDto ToDto(MonthlyExpenses? e) =>
        new(e?.WagesAndBenefits, e?.LabourHours, e?.OtherControllableCosts, e?.OccupationCost, e?.Interest, e?.Depreciation, e?.UpdatedAtUtc, e?.UpdatedBy);

    private static Kpi Ranged(string key, decimal? value, (decimal From, decimal To) range, bool highIsBad, string? missing) =>
        new(key, missing is null ? value : null, range.From, range.To, highIsBad,
            missing is not null || value is null ? KpiStatus.Missing
            : value > range.To ? KpiStatus.Above
            : value < range.From ? KpiStatus.Below
            : KpiStatus.Healthy,
            missing ?? (value is null ? "Nothing to measure this month." : null));

    private static Kpi Unranged(string key, decimal? value, string? missing) =>
        new(key, missing is null ? value : null, null, null, false, missing is null && value is not null ? KpiStatus.NoRange : KpiStatus.Missing, missing);
}
```


**تآكل الهامش (`DiscountImpact` و`Erosion`):** من توريدات الشهر: الإيراد القياسي = صافي المبيعات + الخصومات؛ نسبة التكلفة القياسية = التكلفة النظرية ÷ الإيراد القياسي، والفعلية = التكلفة النظرية ÷ صافي المبيعات؛ والتآكل = الفعلية − القياسية بالنقاط. والأسباب مجمعة بالاسم (اليوم الملغى يُطرح بعكسه)، الأكبر أولًا.

#### العروض المجمعة: التكلفة من الأصناف

`ComboPartsAsync` يحمّل أجزاء كل العروض بالرقم لخدمات التقارير التي تفجر المبيعات (التكلفة النظرية، الاستهلاك، نقطة التعادل اليومية). و`GetComboOffersAsync` يجمع تكلفة كل عرض من كروت وصفات أصنافه: التكلفة = مجموع (تكلفة الحصة × العدد)، والسعر الأصلي = مجموع (السعر × العدد)، ونسبة التكلفة = التكلفة ÷ سعر العرض. و`Card(target)` لصنف عرض على المنيو يعطي كارتًا من أصنافه (`ComboCard`)، فقائمة المنيو والتكلفة الكلية للطبق تحسبانه.

> 📄 **`backend/src/Costing.Infrastructure/Reports/ComboLoading.cs`** — 13 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Recipes;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Reports;

internal static class ComboLoading
{
    // What each combo is made of, by the menu number it is sold under, deleted ones too (their
    // sales still took stock by them): for StockRequirements.For.
    public static async Task<IReadOnlyDictionary<int, IReadOnlyList<ComboPart>>> ComboPartsAsync(this CostingDbContext db, CancellationToken cancellationToken) =>
        (await db.ComboOffers.AsNoTracking().ToListAsync(cancellationToken)).ToDictionary(c => c.Code, c => c.Parts);
}
```


> 📄 **`backend/src/Costing.Infrastructure/Reports/CostingService.Combos.cs`** — 107 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Menu;
using Costing.Domain.Recipes;

namespace Costing.Infrastructure.Reports;

// A dish in a combo, as its recipe costs it today: a portion's cost and its own price (the menu's, or
// a planned price off the menu), and the combo's quantity of each.
public sealed record ComboDishDto(
    Guid RecipeId, string Dish, string? ItemCode, int Quantity, decimal CostPerPortion, decimal LineCost, decimal? Price, decimal? LinePrice,
    bool IsDeleted, IReadOnlyList<string> MissingPrices);

// A combo offer and its roll-up (عرض مجمع):
//
//   Total combo cost        = Σ each dish's cost a portion × its quantity
//   Original separate price = Σ each dish's own price × its quantity (none when a dish has no price)
//   Combo food cost %       = total combo cost ÷ the combo's selling price × 100
//   Savings                 = original separate price − the combo's price
public sealed record ComboOfferDto(
    Guid Id,
    int Code,
    string Name,
    string? NameAr,
    decimal SellingPrice,
    bool IsActive,
    bool IsDeleted,
    IReadOnlyList<ComboDishDto> Items,
    decimal TotalCost,
    decimal? OriginalPrice,
    decimal? Savings,
    decimal? SavingsPercent,
    decimal? FoodCostPercent,
    decimal FoodCostTargetPercent,
    CostStatus Status,
    IReadOnlyList<string> MissingPrices);

// NextCode: the menu number a new combo starts with, after the highest on the menu.
public sealed record ComboOffersReport(int NextCode, decimal FoodCostTargetPercent, IReadOnlyList<ComboOfferDto> Combos);

public sealed partial class CostingService
{
    public const int FirstMenuNumber = 1001;

    // Every combo, by its code; the deleted ones only when asked for.
    public async Task<ComboOffersReport> GetComboOffersAsync(bool includeDeleted, CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        var combos = await db.ComboOffers.AsNoTracking()
            .Where(c => includeDeleted || c.DeletedAtUtc == null)
            .OrderBy(c => c.Code)
            .ToListAsync(cancellationToken);
        var highest = await db.MenuItems.AsNoTracking().IgnoreQueryFilters().MaxAsync(m => (int?)m.Id, cancellationToken) ?? 0;
        return new ComboOffersReport(Math.Max(FirstMenuNumber, highest + 1), data.FoodCostTarget, combos.Select(c => Combo(c, data)).ToList());
    }

    private static ComboOfferDto Combo(ComboOffer combo, MenuData data)
    {
        var (dishes, total, original, missing) = RollUp(combo, data);
        var foodCost = combo.SellingPrice > 0 ? Percent(total / combo.SellingPrice) : (decimal?)null;
        decimal? savings = original is { } o ? Money(o - combo.SellingPrice) : null;
        return new ComboOfferDto(
            combo.Id, combo.Code, combo.Name, combo.NameAr, combo.SellingPrice, combo.IsActive, combo.IsDeleted, dishes, total, original, savings,
            original is > 0 ? Percent(savings!.Value / original.Value) : null, foodCost, data.FoodCostTarget,
            missing.Count > 0 ? CostStatus.MissingPrices : foodCost > data.FoodCostTarget ? CostStatus.AboveTarget : CostStatus.WithinTarget,
            missing);
    }

    // Each dish at its recipe's cost today, as its own card costs it (its shared costs a meal too).
    private static (IReadOnlyList<ComboDishDto> Dishes, decimal Total, decimal? Original, IReadOnlyList<string> Missing) RollUp(ComboOffer combo, MenuData data)
    {
        var dishes = new List<ComboDishDto>();
        foreach (var part in combo.Parts)
        {
            if (data.AllRecipes.FirstOrDefault(r => r.Id == part.RecipeId) is not { } recipe)
                continue;
            var card = Card(recipe, data);
            dishes.Add(new ComboDishDto(
                recipe.Id, card.Recipe, card.ItemCode == "" ? null : card.ItemCode, part.Quantity, card.CostPerPortion, Money(card.CostPerPortion * part.Quantity),
                card.MenuPrice, card.MenuPrice is { } price ? Money(price * part.Quantity) : null, recipe.IsDeleted, card.MissingPrices));
        }
        var original = dishes.All(d => d.LinePrice is not null) ? dishes.Sum(d => d.LinePrice!.Value) : (decimal?)null;
        return (dishes, Money(dishes.Sum(d => d.LineCost)), original is { } o ? Money(o) : null,
            dishes.SelectMany(d => d.MissingPrices).Distinct().ToList());
    }

    // The combo sold under a menu row's number, if one is.
    private static ComboOffer? ComboOf(Target target, MenuData data) =>
        target is { Kind: RecipeTargetKind.MenuItem, VariantId: null } && data.Combos.TryGetValue(target.CatalogItemId, out var combo) ? combo : null;

    // A combo's menu row as a costing card: its dishes' costs together, against its price. It has no
    // recipe or lines of its own.
    private static RecipeCostCard ComboCard(Target target, ComboOffer combo, MenuData data)
    {
        var (dishes, total, _, missing) = RollUp(combo, data);
        var shared = Money(dishes.Sum(d => (data.AllRecipes.First(r => r.Id == d.RecipeId) is var r ? Card(r, data).SharedCostPerPortion : 0) * d.Quantity));
        var price = target.Price;
        var foodCost = price > 0 ? Percent(total / price.Value) : (decimal?)null;
        var status = missing.Count > 0 ? CostStatus.MissingPrices
            : foodCost is null ? CostStatus.NoPrice
            : foodCost > data.FoodCostTarget ? CostStatus.AboveTarget : CostStatus.WithinTarget;
        return new RecipeCostCard(
            RecipeTargetKind.MenuItem, target.CatalogItemId, null, ItemCode(target.CatalogItemId, null), target.Name, target.NameAr, target.Category,
            true, 1, price, data.FoodCostTarget, [], total, Money(total - shared), shared, total,
            price is { } p ? Money(p - total) : null, foodCost, Money(total * 100 / data.FoodCostTarget), missing, status,
            LinkedTo: target.Name, ComboOfferId: combo.Id);
    }
}
```


### 4.3 نقطة التعادل وسيناريوهاتها

```text
المبيعات السنوية    = المبيعات الأسبوعية × 52
تكلفة المبيعات      = بنسبة الأشهر المختارة نفسها (غير مقرّبة)
التكاليف الثابتة    = (المدخلة شهريًا + فواتير المصروفات المسجلة) ، متوسط الأشهر التي فيها تكاليف × 12
هامش الربح          = 1 − (التكلفة المتغيرة ÷ المبيعات)
نقطة التعادل        = التكاليف الثابتة ÷ هامش الربح   (null إن كان كل بيع خاسرًا)
```

وأربعة سيناريوهات للمبيعات الأسبوعية تُحفظ للمرة القادمة.

> 📄 **`backend/src/Costing.Infrastructure/Reports/BreakEvenService.cs`** — 131 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// The worksheet's Income Statement column: the chosen months at a year's pace, as the template
// lays it out. Gross sales = weekly sales × 52; cost of sales at the months' own ratio; fixed
// costs are the monthly costs entered plus the expense invoices logged, averaged over the months
// that have any, × 12. Each row says how much of it came from invoices.
public sealed record BreakEvenWorksheet(
    DateOnly From,
    DateOnly To,
    // Days of sales the pace is taken from: the whole of each month, up to today in this one.
    int Days,
    decimal WeeklySales,
    decimal GrossSales,
    decimal CostOfSales,
    // Cost of sales ÷ sales, unrounded: the options are worked out at the same ratio.
    decimal CostOfSalesRatio,
    decimal GrossProfit,
    decimal ControllableCosts,
    decimal OccupationCost,
    decimal Interest,
    decimal Depreciation,
    // Logged expenses whose category counts them as other fixed costs: insurance, licences.
    decimal OtherFixedCosts,
    decimal TotalFixedCosts,
    decimal RestaurantProfit,
    // Total fixed costs ÷ profit margin. Null when every sale loses money: no level of sales breaks even.
    decimal? BreakEvenYearlySales,
    decimal? BreakEvenWeeklySales,
    // Months in the range with no costs entered; with none at all, there are no fixed costs to break even on.
    IReadOnlyList<string> MonthsWithoutCosts,
    IReadOnlyList<decimal> Scenarios,
    // Of ControllableCosts and OccupationCost, what came from expense invoices rather than typed in.
    decimal ControllableFromInvoices,
    decimal OccupationFromInvoices);

// The sixth template: the Break-Even Analysis and Scenario Worksheet.
public sealed class BreakEvenService(CostingDbContext db, IBusinessCalendar clock, KpiService kpis)
{
    private const int WeeksInYear = 52;

    public async Task<BreakEvenWorksheet> GetAsync(int fromYear, int fromMonth, int toYear, int toMonth, CancellationToken cancellationToken)
    {
        if (fromMonth is < 1 or > 12 || toMonth is < 1 or > 12)
            throw new DomainException("Choose the months.");
        var first = new DateOnly(fromYear, fromMonth, 1);
        var lastMonth = new DateOnly(toYear, toMonth, 1);
        var today = clock.BusinessDateOf(DateTime.UtcNow);
        if (lastMonth < first)
            throw new DomainException("The first month must come before the last.");
        if (lastMonth > new DateOnly(today.Year, today.Month, 1))
            throw new DomainException("Choose months that have begun.");
        if (lastMonth.AddMonths(-23) > first)
            throw new DomainException("Choose two years at most.");

        decimal revenue = 0, costOfSales = 0, controllable = 0, occupation = 0, interest = 0, depreciation = 0, otherFixed = 0;
        decimal controllableLogged = 0, occupationLogged = 0;
        var days = 0;
        var withCosts = 0;
        var withoutCosts = new List<string>();
        for (var month = first; month <= lastMonth; month = month.AddMonths(1))
        {
            var report = await kpis.GetAsync(month.Year, month.Month, cancellationToken);
            revenue += report.Statement.Revenue;
            costOfSales += report.Statement.CostOfSales;
            var monthEnd = month.AddMonths(1).AddDays(-1);
            days += (monthEnd < today ? monthEnd : today).DayNumber - month.DayNumber + 1;

            var e = report.Expenses;
            var s = report.Statement;
            var logged = s.LoggedControllableCosts + s.LoggedOccupationCost + s.LoggedOtherFixedCosts + s.LoggedWages;
            if (e.WagesAndBenefits is null && e.OtherControllableCosts is null && e.OccupationCost is null && e.Interest is null && e.Depreciation is null
                && logged == 0 && s.AssetDepreciation == 0)
            {
                withoutCosts.Add(month.ToString("MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture));
                continue;
            }
            withCosts++;
            controllable += (e.WagesAndBenefits ?? 0) + (e.OtherControllableCosts ?? 0) + s.LoggedControllableCosts + s.LoggedWages;
            occupation += (e.OccupationCost ?? 0) + s.LoggedOccupationCost;
            otherFixed += s.LoggedOtherFixedCosts;
            interest += e.Interest ?? 0;
            // Entered for the month, and the fixed assets register's.
            depreciation += s.DepreciationExpense;
            controllableLogged += s.LoggedControllableCosts + s.LoggedWages;
            occupationLogged += s.LoggedOccupationCost;
        }

        decimal Yearly(decimal total) => withCosts > 0 ? Money(total * 12 / withCosts) : 0;
        var weekly = days > 0 ? revenue / days * 7 : 0;
        var grossSales = weekly * WeeksInYear;
        var ratio = revenue > 0 ? costOfSales / revenue : 0;
        var yearlyCostOfSales = grossSales * ratio;
        var grossProfit = grossSales - yearlyCostOfSales;
        var (yearlyControllable, yearlyOccupation, yearlyInterest, yearlyDepreciation, yearlyOtherFixed) =
            (Yearly(controllable), Yearly(occupation), Yearly(interest), Yearly(depreciation), Yearly(otherFixed));
        var fixedCosts = yearlyControllable + yearlyOccupation + yearlyInterest + yearlyDepreciation + yearlyOtherFixed;

        // Each L.E of sales leaves (1 − ratio) towards the fixed costs.
        decimal? breakEven = withCosts > 0 && ratio < 1 ? fixedCosts / (1 - ratio) : null;

        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var periodEnd = lastMonth.AddMonths(1).AddDays(-1);
        return new BreakEvenWorksheet(
            first, periodEnd < today ? periodEnd : today, days,
            Money(weekly), Money(grossSales), Money(yearlyCostOfSales), ratio, Money(grossProfit),
            yearlyControllable, yearlyOccupation, yearlyInterest, yearlyDepreciation, yearlyOtherFixed, fixedCosts,
            Money(grossProfit - fixedCosts),
            Money(breakEven), breakEven is { } b ? Money(b / WeeksInYear) : null,
            withoutCosts, settings.BreakEvenScenarios, Yearly(controllableLogged), Yearly(occupationLogged));
    }

    // The four options' weekly sales, kept for next time.
    public async Task<IReadOnlyList<decimal>> SaveScenariosAsync(IReadOnlyList<decimal> scenarios, CancellationToken cancellationToken)
    {
        if (scenarios.Count > 4 || scenarios.Any(s => s < 0))
            throw new DomainException("Up to four options, each a weekly sales figure of zero or more.");
        var row = await db.CostingSettings.SingleOrDefaultAsync(cancellationToken);
        if (row is null)
            db.CostingSettings.Add(row = new CostingSettings());
        row.BreakEvenScenarios = scenarios.Select(s => Money(s)).ToList();
        await db.SaveChangesAsync(cancellationToken);
        return row.BreakEvenScenarios;
    }
}
```


#### نقطة التعادل اليومية الديناميكية

الورقة السابقة تنظر إلى الشهر بأثر رجعي؛ أما `DailyBreakEvenService` فيحكم على **اليوم** نفسه، بمزيج أطباقه هو:

```text
نصيب اليوم من الثابت = المصاريف الثابتة للشهر ÷ عدد أيامه
صافي المبيعات        = مبيعات اليوم بأسعار المنيو بعد خصم كل فاتورة، قبل الضريبة
تكلفة الخامات        = Σ الكمية × تكلفة حصة وصفتها اليوم (RecipeCosts)
هامش المساهمة        = صافي المبيعات − تكلفة الخامات ؛  WACM = ÷ صافي المبيعات
نقطة التعادل اليومية = نصيب اليوم من الثابت ÷ WACM
النتيجة التشغيلية    = هامش المساهمة − نصيب اليوم من الثابت
```

المصاريف الثابتة للشهر **لا تُحسب مرتين في الكود**: هي وعاءا العمالة والتشغيل من محرك التكلفة الكلية للطبق للشهر كاملًا (`BurdenedCostService.ActualAsync`، صار `internal` لهذا)، بأرقامه التقديرية للشهر الخالي. واليوم بلا مبيعات يأخذ WACM الأيام السبعة السابقة ويقول ذلك. والمبيعات تُجمع باليوم التجاري للإيصال (`SaleOrder.BusinessDate`)، لا بساعة البيع.

> 📄 **`backend/src/Costing.Infrastructure/Reports/DailyBreakEvenService.cs`** — 158 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.Recipes;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// The dynamic daily break-even (نقطة التعادل اليومية الديناميكية): what a day must sell to cover its
// share of the month's fixed costs, at the contribution margin of what it actually sold.
//
//   Daily fixed cost        = the month's fixed costs ÷ its days
//   Net sales               = the day's sales at the menu's prices, less each bill's discount, before VAT
//   Food cost               = what those plates' recipes cost at today's costs (RecipeCosts)
//   Contribution margin     = net sales − food cost
//   WACM %                  = contribution margin ÷ net sales × 100   (the weighted average, by today's mix)
//   Break-even sales        = daily fixed cost ÷ WACM
//   Operating result        = contribution margin − daily fixed cost
//
// The month's fixed costs are the burdened plate cost's pools for the whole month: its labor
// (payroll, salaries, wages entered and paid as expenses) and its overheads (rent, controllable
// costs, interest, depreciation, and the expense invoices and vouchers under them). A month with
// nothing recorded for one takes its stand-in from Cost settings, so a day early in a month still
// has a target. A day with no sales yet takes the WACM of the seven days before it.
public sealed record DailyBreakEven(
    DateOnly Date,
    bool IsToday,
    int DaysInMonth,
    decimal MonthlyFixedCosts,
    decimal DailyFixedCosts,
    // The month's pools the fixed costs are made of, and the months that took a stand-in.
    CostPool Labor,
    CostPool Overhead,
    decimal NetSales,
    decimal FoodCost,
    decimal? FoodCostPercent,
    decimal ContributionMargin,
    // The margin the target is worked at: today's, or the seven days before's when nothing sold yet.
    decimal? WacmPercent,
    bool WacmEstimated,
    DateOnly? HistoryFrom,
    DateOnly? HistoryTo,
    decimal? BreakEvenSales,
    // Still to sell to break even; none once reached.
    decimal? StillToSell,
    // Sales against the target, as a percentage.
    decimal? ProgressPercent,
    bool BreakEvenReached,
    decimal OperatingResult,
    int Plates,
    // Sold with no recipe: in the sales at no food cost, so the margin reads high.
    int PlatesWithoutRecipe,
    decimal SalesWithoutRecipe,
    bool MissingPrices);

public sealed class DailyBreakEvenService(CostingDbContext db, IBusinessCalendar clock, SalesLedger ledger, BurdenedCostService pools)
{
    private const int HistoryDays = 7;

    // A day's sales by its mix: what was sold for, what its recipes cost now, and the plates.
    private sealed record DaySales(decimal NetSales, decimal FoodCost, int Plates, int PlatesWithoutRecipe, decimal SalesWithoutRecipe, bool MissingPrices);

    public async Task<DailyBreakEven> GetAsync(DateOnly? date, CancellationToken cancellationToken)
    {
        var today = clock.BusinessDateOf(DateTime.UtcNow);
        var day = date ?? today;
        if (day > today)
            throw new DomainException("Choose a day that has begun. · اختر يومًا بدأ.");
        if (day < today.AddYears(-5))
            throw new DomainException("Choose a day in the last five years. · اختر يومًا خلال خمس سنوات.");

        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();
        var month = new DateOnly(day.Year, day.Month, 1);
        var monthEnd = month.AddMonths(1).AddDays(-1);
        var daysInMonth = monthEnd.Day;
        var (labor, overhead) = await pools.ActualAsync(month, monthEnd, settings, cancellationToken);
        var monthlyFixed = labor.Total + overhead.Total;
        var dailyFixed = monthlyFixed / daysInMonth;

        var historyFrom = day.AddDays(-HistoryDays);
        var sales = await SalesByDayAsync(historyFrom, day, cancellationToken);
        var sold = sales.GetValueOrDefault(day) ?? new DaySales(0, 0, 0, 0, 0, false);
        var margin = sold.NetSales - sold.FoodCost;

        decimal? wacm = sold.NetSales > 0 ? margin / sold.NetSales : null;
        var estimated = false;
        if (wacm is null)
        {
            var before = sales.Where(s => s.Key < day).Select(s => s.Value).ToList();
            var historySales = before.Sum(s => s.NetSales);
            if (historySales > 0)
            {
                wacm = (historySales - before.Sum(s => s.FoodCost)) / historySales;
                estimated = true;
            }
        }

        decimal? target = wacm > 0 ? dailyFixed / wacm.Value : null;
        var reached = target is { } t && sold.NetSales >= t && t >= 0;
        return new DailyBreakEven(
            day, day == today, daysInMonth, Money(monthlyFixed), Money(dailyFixed), labor, overhead,
            Money(sold.NetSales), Money(sold.FoodCost), sold.NetSales > 0 ? Percent(sold.FoodCost / sold.NetSales) : null, Money(margin),
            wacm is { } w ? Percent(w) : null, estimated, estimated ? historyFrom : null, estimated ? day.AddDays(-1) : null,
            Money(target), target is { } s ? Money(Math.Max(0, s - sold.NetSales)) : null,
            target > 0 ? Percent(sold.NetSales / target.Value) : null, reached,
            Money(margin - dailyFixed), sold.Plates, sold.PlatesWithoutRecipe, Money(sold.SalesWithoutRecipe), sold.MissingPrices);
    }

    // Each day's sales from first to last, at the menu's prices less each bill's discount shared
    // over its lines by value, before VAT; delivery fees are not food. Each line costed by the
    // recipes it sells by (its add-ons' too) at today's costs, prep items by RecipeCosts.
    private async Task<IReadOnlyDictionary<DateOnly, DaySales>> SalesByDayAsync(DateOnly first, DateOnly last, CancellationToken cancellationToken)
    {
        var (from, _) = clock.Bounds(first);
        var (_, to) = clock.Bounds(last);
        var orders = await ledger.GetAsync(from, to, cancellationToken);
        if (orders.Count == 0)
            return new Dictionary<DateOnly, DaySales>();

        var recipes = await db.Recipes.AsNoTracking().Include(r => r.Ingredients).Where(r => r.DeletedAtUtc == null).ToListAsync(cancellationToken);
        var combos = await db.ComboPartsAsync(cancellationToken);
        var materials = await db.RawMaterials.AsNoTracking().ToDictionaryAsync(m => m.Id, cancellationToken);
        var costs = new RecipeCosts(materials, await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken));

        return orders
            .Where(o => o.BusinessDate >= first && o.BusinessDate <= last)
            .GroupBy(o => o.BusinessDate)
            .ToDictionary(g => g.Key, g =>
            {
                decimal net = 0, food = 0, withoutRecipe = 0;
                int plates = 0, platesWithoutRecipe = 0;
                var missing = false;
                foreach (var order in g)
                {
                    var billed = order.BilledSubtotal;
                    var kept = billed > 0 ? 1 - Math.Min(order.DiscountAmount, billed) / billed : 1;
                    foreach (var line in order.Lines.Where(l => l.OnBill && l.Quantity > 0))
                    {
                        var revenue = line.LineTotal * kept;
                        net += revenue;
                        plates += line.Quantity;
                        var needs = StockRequirements.For(new SoldItem(line.MenuItemId, line.VariantId, line.AddOnIds, line.Quantity), recipes, combos);
                        if (needs.Count == 0)
                        {
                            platesWithoutRecipe += line.Quantity;
                            withoutRecipe += revenue;
                            continue;
                        }
                        food += needs.Sum(n => n.Value * (costs.Of(n.Key).PerUnit ?? 0));
                        missing |= needs.Keys.Any(id => costs.Of(id).PerUnit is null || costs.Of(id).Missing.Count > 0);
                    }
                }
                return new DaySales(net, food, plates, platesWithoutRecipe, withoutRecipe, missing);
            });
    }
}
```


#### محاكي التضخم والتسعير (What-If)

يعيد تكلفة كل طبق ووصفة خارج المنيو ومصنع **بأسعار افتراضية في الذاكرة**، لا شيء يُحفظ. القاعدة **الأدق تغلب** ولا تتراكب: سعر الخامة الجديد > نسبة فئتها > النسبة العامة > كما هي. والسر في `RecipeCosts`: مُنشئ جديد يأخذ دالة `simulated` تعطي سعر الخامة المشتراة، والمصنع المصنوع يأخذ متوسطه × (تكلفة دفعته بالأسعار الجديدة ÷ تكلفتها الآن)، فالمصنع داخل المصنع يتحرك بما صُنع منه. ثم `data with { Costs = simulatedCosts }` فيُعاد استخدام `Card` نفسه بلا تكرار للمنطق.

```
السعر المقترح (ثبات نسبة التكلفة) = السعر × التكلفة المحاكاة ÷ التكلفة الحالية
السعر المقترح (ثبات هامش النقدية) = السعر + (التكلفة المحاكاة − التكلفة الحالية)
أثر الربح الشهري                  = (الحالية − المحاكاة) × أطباق آخر 30 يومًا
```

> 📄 **`backend/src/Costing.Infrastructure/Reports/CostingService.Inflation.cs`** — 175 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Infrastructure.Reports;

// The inflation & pricing simulator (محاكي التضخم والتسعير): every dish, off-menu recipe and prep
// item costed again at hypothetical prices, in memory, nothing saved. The price of a bought material
// changes by the most specific rule given:
//
//   its own new price (per purchase unit)  >  its category's %  >  the global %  >  as it is
//
// A prep item never made is costed by its recipe at the new prices; one made, at its average ×
// (its batch at the new prices ÷ its batch now), so nested prep items carry the change through.
//
//   Suggested price (keep food cost %) = price × simulated cost ÷ current cost
//   Suggested price (keep cash margin) = price + (simulated cost − current cost)
//   Monthly profit impact              = (current cost − simulated cost) × plates sold in the last 30 days
public sealed record CategoryInflation(Guid CategoryId, decimal Percent);

public sealed record MaterialPriceOverride(Guid RawMaterialId, decimal CostPerPurchaseUnit);

public sealed record InflationScenario(decimal? GlobalPercent, IReadOnlyList<CategoryInflation>? Categories, IReadOnlyList<MaterialPriceOverride>? Materials);

public enum SimulatedItemKind
{
    Dish = 1,
    OffMenuRecipe = 2,
    PrepItem = 3,
}

// A material whose price the scenario changes, per purchase unit.
public sealed record SimulatedMaterial(Guid RawMaterialId, string Material, string PurchaseUnit, decimal? CurrentPrice, decimal SimulatedPrice, decimal? ChangePercent);

public sealed record SimulatedItem(
    SimulatedItemKind Kind,
    string ItemCode,
    Guid? RecipeId,
    Guid? PrepItemId,
    string Name,
    string? Category,
    // What the cost is for: a portion, or a prep item's display unit (kg, L).
    string Unit,
    decimal? SellingPrice,
    decimal CurrentCost,
    decimal SimulatedCost,
    decimal Change,
    decimal? ChangePercent,
    decimal? CurrentFoodCostPercent,
    decimal? SimulatedFoodCostPercent,
    bool AboveTarget,
    // Within the target now, above it at the new prices.
    bool NewlyAboveTarget,
    decimal? SuggestedPriceKeepFoodCost,
    decimal? SuggestedPriceKeepMargin,
    decimal QuantityLast30Days,
    decimal? MonthlyProfitImpact);

public sealed record InflationReport(
    DateOnly SalesFrom,
    DateOnly SalesTo,
    decimal FoodCostTargetPercent,
    int MaterialsChanged,
    int Dishes,
    int NewlyAboveTarget,
    decimal MonthlyProfitImpact,
    IReadOnlyList<SimulatedMaterial> Materials,
    IReadOnlyList<SimulatedItem> Items);

public sealed partial class CostingService
{
    public const int InflationSalesDays = 30;

    public async Task<InflationReport> SimulateInflationAsync(InflationScenario scenario, CancellationToken cancellationToken)
    {
        static void CheckPercent(decimal percent)
        {
            if (percent is < -90 or > 1000)
                throw new DomainException("A change is a percentage from −90% to +1,000%. · نسبة التغير من −90% إلى +1000%.");
        }
        if (scenario.GlobalPercent is { } global)
            CheckPercent(global);
        foreach (var category in scenario.Categories ?? [])
            CheckPercent(category.Percent);
        if ((scenario.Materials ?? []).Any(m => m.CostPerPurchaseUnit < 0))
            throw new DomainException("A new price cannot be negative. · السعر الجديد لا يكون سالبًا.");

        var data = await LoadMenuAsync(cancellationToken);
        var byCategory = (scenario.Categories ?? []).GroupBy(c => c.CategoryId).ToDictionary(g => g.Key, g => g.Last().Percent);
        var byMaterial = (scenario.Materials ?? []).GroupBy(m => m.RawMaterialId).ToDictionary(g => g.Key, g => g.Last().CostPerPurchaseUnit);

        // A bought material's simulated cost a unit, by the most specific rule; null: as it is.
        decimal? Simulated(RawMaterial m)
        {
            if (byMaterial.TryGetValue(m.Id, out var price))
                return m.PurchaseUnitSize > 0 ? price / m.PurchaseUnitSize : null;
            var percent = byCategory.TryGetValue(m.CategoryId, out var p) ? p : scenario.GlobalPercent;
            return percent is { } change && m.AverageCost is { } average ? average * (1 + change / 100) : null;
        }

        var prepRecipes = await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken);
        var simulatedCosts = new RecipeCosts(data.Materials, prepRecipes, Simulated);
        var simulated = data with { Costs = simulatedCosts };

        var today = clock.BusinessDateOf(DateTime.UtcNow);
        var salesFrom = today.AddDays(-(InflationSalesDays - 1));
        var sold = (await SalesAsync(salesFrom, today, cancellationToken))
            .GroupBy(s => (s.MenuItemId, s.VariantId))
            .ToDictionary(g => g.Key, g => (decimal)g.Sum(s => s.Quantity));
        var target = data.FoodCostTarget;

        SimulatedItem Item(SimulatedItemKind kind, RecipeCostCard now, RecipeCostCard then, decimal quantity)
        {
            var (current, next) = (now.CostPerPortion, then.CostPerPortion);
            var price = kind == SimulatedItemKind.Dish ? now.MenuPrice : now.PlannedPrice;
            decimal? Fc(decimal cost) => price > 0 ? Percent(cost / price.Value) : null;
            var (fcNow, fcThen) = (Fc(current), Fc(next));
            return new SimulatedItem(
                kind, now.ItemCode, now.RecipeId, null, now.Recipe, now.Category, "portion", price, current, next, Money(next - current),
                current > 0 ? Percent(next / current - 1) : null, fcNow, fcThen, fcThen > target, fcThen > target && !(fcNow > target),
                price > 0 && current > 0 ? Money(price.Value * next / current) : null, price is { } p ? Money(p + next - current) : null,
                quantity, kind == SimulatedItemKind.Dish ? Money((current - next) * quantity) : null);
        }

        var items = new List<SimulatedItem>();
        foreach (var menuTarget in data.Targets.Where(t => t.Kind == RecipeTargetKind.MenuItem))
        {
            var own = data.Recipes.GetValueOrDefault(new RecipeTarget(menuTarget.Kind, menuTarget.CatalogItemId, menuTarget.VariantId));
            var recipe = own ?? (menuTarget.VariantId is not null ? data.Recipes.GetValueOrDefault(RecipeTarget.ForMenuItem(menuTarget.CatalogItemId)) : null);
            if (recipe is null)
                continue;
            var baseUsed = own is null;
            items.Add(Item(SimulatedItemKind.Dish, Card(menuTarget, recipe, baseUsed, data), Card(menuTarget, recipe, baseUsed, simulated),
                sold.GetValueOrDefault((menuTarget.CatalogItemId, menuTarget.VariantId))));
        }
        foreach (var recipe in data.AllRecipes.Where(r => !r.IsDeleted && !r.IsLinked))
            items.Add(Item(SimulatedItemKind.OffMenuRecipe, Card(recipe, data), Card(recipe, simulated), 0));
        foreach (var prep in prepRecipes)
        {
            if (data.Materials.GetValueOrDefault(prep.PrepItemId) is not { IsArchived: false } material)
                continue;
            var size = material.PurchaseUnitSize;
            var (now, then) = (data.Costs.Of(material.Id).PerUnit, simulatedCosts.Of(material.Id).PerUnit);
            if (now is not { } current || then is not { } next)
                continue;
            items.Add(new SimulatedItem(
                SimulatedItemKind.PrepItem, material.Code ?? "", null, material.Id, material.Name, "Prep item · مصنّع", material.PurchaseUnit, null,
                Money(current * size), Money(next * size), Money((next - current) * size), current > 0 ? Percent(next / current - 1) : null,
                null, null, false, false, null, null, 0, null));
        }

        var changed = data.Materials.Values
            .Where(m => !m.IsPrepItem && !m.IsArchived && Simulated(m) is { } next && next != m.AverageCost)
            .Select(m => new SimulatedMaterial(
                m.Id, m.Name, m.PurchaseUnit, Money(m.AverageCost * m.PurchaseUnitSize), Money(Simulated(m)!.Value * m.PurchaseUnitSize),
                m.AverageCost > 0 ? Percent(Simulated(m)!.Value / m.AverageCost.Value - 1) : null))
            .OrderByDescending(m => Math.Abs(m.ChangePercent ?? 0))
            .ThenBy(m => m.Material, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        items = items
            .OrderBy(i => i.Kind)
            .ThenByDescending(i => i.NewlyAboveTarget)
            .ThenBy(i => i.MonthlyProfitImpact ?? 0)
            .ThenByDescending(i => i.Change)
            .ThenBy(i => i.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        var dishes = items.Where(i => i.Kind == SimulatedItemKind.Dish).ToList();
        return new InflationReport(
            salesFrom, today, target, changed.Count, dishes.Count, items.Count(i => i.NewlyAboveTarget),
            Money(dishes.Sum(i => i.MonthlyProfitImpact ?? 0)), changed, items);
    }
}
```


#### أين تُستخدم الخامة، ومعاينة الاستبدال

**أين تُستخدم (`GetWhereUsedAsync`):** لكل وصفة ومصنّع غير محذوف: الكمية في الوصفة كما كُتبت ÷ الحصص، وما تأخذه مصنّعاتها منه (`PrepContents`: نصيب الجرام من المصنّع من الخامة، بالوزن قبل التنظيف، عبر كل المستويات، مع حماية من الدوران)، وتكلفته في الحصة.

**المعاينة (`PreviewSwapAsync`):** في الذاكرة فقط. تُقرأ وصفات المصنّعات مرتين (كما هي، وكما يتركها الاستبدال) لأن القراءة بلا تتبع تعطي نسخًا مستقلة، ويُعدّل المختار منها. ثم `new RecipeCosts(materials, swapped, actual)`: مُنشئ جديد يجعل المصنّع المُنتج من قبل = متوسطه × (دفعته بالجديدة ÷ دفعته الآن)، أي تكلفته من الدفعة القادمة، وهو نفس منطق محاكي التضخم بعد تعميم `_actual.Batch` ليأخذ وصفة `actual` نفسها. والأطباق التي لا تحتوي الخامة مباشرة لكن تتأثر عبر مصنّع مختار تظهر منفصلة (`KnockOn`).

> 📄 **`backend/src/Costing.Infrastructure/Reports/CostingService.WhereUsed.cs`** — 322 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Recipes;
using Costing.Domain.Approvals;
using Costing.Domain.Common;
using Costing.Domain.Production;
using Costing.Domain.RawMaterials;
using Costing.Domain.Recipes;

namespace Costing.Infrastructure.Reports;

public enum WhereUsedKind
{
    Dish = 1,
    OffMenuRecipe = 2,
    PrepItem = 3,
}

// One recipe or prep item that uses the item (أين تُستخدم الخامة). For a dish, per portion; for a
// prep item, per batch (BatchQuantity of its Unit). Quantity: as the recipe writes it (edible
// portion), when the item is on it; ThroughPrepItems: what its prep items take of it, as
// purchased, Via naming them. ItemCost: what the item costs in it, at today's costs. Cost: the
// portion's cost (a prep item's: the batch's); Price: the menu's (a planned price off the menu).
public sealed record WhereUsedRow(
    WhereUsedKind Kind,
    Guid Id,
    string Name,
    string? ItemCode,
    string? Category,
    int? Portions,
    decimal? BatchQuantity,
    UnitOfMeasure? BatchUnit,
    decimal? Price,
    decimal? Cost,
    decimal? FoodCostPercent,
    decimal? Quantity,
    decimal? ThroughPrepItems,
    IReadOnlyList<string> Via,
    decimal? ItemCost);

public sealed record WhereUsedReport(
    Guid MaterialId,
    string Material,
    string? Code,
    bool IsPrepItem,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    int Dishes,
    int PrepItems,
    IReadOnlyList<WhereUsedRow> Rows);

public sealed record SwapPreviewRequest(Guid FromMaterialId, Guid ToMaterialId, decimal Ratio, IReadOnlyList<Guid>? RecipeIds = null, IReadOnlyList<Guid>? PrepItemIds = null);

public sealed record SwapItem(Guid Id, string Name, string? Code, bool IsPrepItem, UnitOfMeasure Unit, string PurchaseUnit, decimal PurchaseUnitSize, decimal? CostPerUnit);

// A recipe or prep item with the old item on it, as the swap would leave it. Quantities in each
// item's own unit, as the recipe writes them (a dish's for all its portions, a prep item's for a
// batch); Merged: the new item was on it already, and takes the quantity added to its own. Cost:
// a dish's a portion, a prep item's a batch. Blocked: why it cannot be swapped now (a request
// waiting for a manager, a prep item that would be made from itself, or one for a manager).
public sealed record SwapPreviewRow(
    WhereUsedKind Kind,
    Guid Id,
    string Name,
    string? ItemCode,
    string? Category,
    int? Portions,
    decimal? BatchQuantity,
    decimal OldQuantity,
    decimal NewQuantity,
    bool Merged,
    decimal? OldCost,
    decimal? NewCost,
    decimal? CostDelta,
    decimal? Price,
    decimal? OldFoodCostPercent,
    decimal? NewFoodCostPercent,
    bool Selected,
    string? Blocked,
    // A prep item made already: what is on the shelf was made with the old item.
    bool FromNextBatch);

// A dish without the old item on it, whose cost moves through a prep item chosen (Via).
public sealed record SwapKnockOn(
    WhereUsedKind Kind, Guid Id, string Name, string? ItemCode, IReadOnlyList<string> Via, decimal? OldCost, decimal? NewCost, decimal? CostDelta,
    decimal? Price, decimal? OldFoodCostPercent, decimal? NewFoodCostPercent, bool FromNextBatch);

public sealed record SwapPreview(
    SwapItem From,
    SwapItem To,
    decimal Ratio,
    bool UnitsDiffer,
    IReadOnlyList<SwapPreviewRow> Rows,
    IReadOnlyList<SwapKnockOn> KnockOn);

public sealed partial class CostingService
{
    // Every recipe and prep item not deleted that uses the material or prep item, on it or inside
    // its prep items, at any depth: dishes first, then prep items, each by name.
    public async Task<WhereUsedReport> GetWhereUsedAsync(Guid materialId, CancellationToken cancellationToken)
    {
        var data = await LoadMenuAsync(cancellationToken);
        var item = data.Materials.GetValueOrDefault(materialId) ?? throw new NotFoundException(nameof(RawMaterial), materialId);
        var batches = (await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken)).ToDictionary(r => r.PrepItemId);
        var inside = new PrepContents(batches, materialId);
        var perUnit = data.Costs.Of(materialId).PerUnit;

        var rows = new List<WhereUsedRow>();
        foreach (var recipe in data.AllRecipes.Where(r => !r.IsDeleted))
        {
            var (direct, through, via) = Uses(recipe.Ingredients.Select(i => (i.RawMaterialId, i.Quantity, i.AsPurchasedQuantity)), materialId, inside, data.Materials);
            if (direct is null && through is null)
                continue;
            var card = Card(recipe, data);
            var portions = recipe.Portions;
            var directAp = recipe.Ingredients.Where(i => i.RawMaterialId == materialId).Sum(i => i.AsPurchasedQuantity);
            rows.Add(new WhereUsedRow(
                recipe.IsLinked ? WhereUsedKind.Dish : WhereUsedKind.OffMenuRecipe, recipe.Id, card.Recipe, card.ItemCode == "" ? null : card.ItemCode,
                card.Category, portions, null, null, card.MenuPrice, card.CostPerPortion, card.FoodCostPercentActual,
                direct / portions, through / portions, via, ItemCost((directAp + (through ?? 0)) / portions, perUnit)));
        }

        foreach (var (id, batch) in batches)
        {
            if (data.Materials.GetValueOrDefault(id) is not { IsArchived: false } prep || id == materialId)
                continue;
            var (direct, through, via) = Uses(batch.Ingredients.Select(i => (i.RawMaterialId, i.Quantity, i.AsPurchasedQuantity)), materialId, inside, data.Materials);
            if (direct is null && through is null)
                continue;
            var directAp = batch.Ingredients.Where(i => i.RawMaterialId == materialId).Sum(i => i.AsPurchasedQuantity);
            var category = batch.RecipeCategoryId is { } c ? data.Categories.GetValueOrDefault(c)?.Name : null;
            rows.Add(new WhereUsedRow(
                WhereUsedKind.PrepItem, id, prep.Name, prep.Code, category, null, batch.BatchQuantity, prep.Unit, null,
                Money(data.Costs.Batch(batch).Cost), null, direct, through, via, ItemCost(directAp + (through ?? 0), perUnit)));
        }

        var ordered = rows.OrderBy(r => r.Kind == WhereUsedKind.PrepItem).ThenBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        return new WhereUsedReport(item.Id, item.Name, item.Code, item.IsPrepItem, item.Unit, item.PurchaseUnit, item.PurchaseUnitSize,
            ordered.Count(r => r.Kind != WhereUsedKind.PrepItem), ordered.Count(r => r.Kind == WhereUsedKind.PrepItem), ordered);
    }

    // The bulk swap's preview: every recipe and prep item with the old item on it, as the swap
    // would leave it (each one's own change, with the prep items chosen swapped too), and the dishes
    // whose cost moves only through those prep items. In memory: nothing is saved.
    public async Task<SwapPreview> PreviewSwapAsync(SwapPreviewRequest request, bool canApprove, CancellationToken cancellationToken)
    {
        IngredientSwap.CheckRatio(request.Ratio);
        if (request.FromMaterialId == request.ToMaterialId)
            throw new DomainException("Choose another item to swap in. · اختر خامة مختلفة.");
        var data = await LoadMenuAsync(cancellationToken);
        var from = data.Materials.GetValueOrDefault(request.FromMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), request.FromMaterialId);
        var to = data.Materials.GetValueOrDefault(request.ToMaterialId) ?? throw new NotFoundException(nameof(RawMaterial), request.ToMaterialId);
        if (to.IsArchived)
            throw new DomainException($"{to.Name} has been deleted from the raw materials: it cannot go on a recipe.");

        // The prep recipes twice over: as they are, and as the swap leaves them.
        async Task<Dictionary<Guid, PrepRecipe>> Batches() =>
            (await db.PrepRecipes.AsNoTracking().Include(r => r.Ingredients).ToListAsync(cancellationToken)).ToDictionary(r => r.PrepItemId);
        var actualBatches = await Batches();
        var swappedBatches = await Batches();
        var pending = (await db.ApprovalRequests.AsNoTracking().Where(r => r.Status == ApprovalStatus.Pending).Select(r => new { r.RecordId, r.RequestedBy })
                .ToListAsync(cancellationToken))
            .GroupBy(r => r.RecordId).ToDictionary(g => g.Key, g => g.First().RequestedBy);
        var inside = to.IsPrepItem ? BulkSwapRules.MadeFrom(to.Id, actualBatches) : new HashSet<Guid>();

        var prepRows = actualBatches.Values
            .Where(b => b.Ingredients.Any(i => i.RawMaterialId == from.Id) && data.Materials.GetValueOrDefault(b.PrepItemId) is { IsArchived: false })
            .Select(b =>
            {
                var item = data.Materials[b.PrepItemId];
                var blocked = pending.TryGetValue(b.PrepItemId, out var by) ? $"{by} has asked a manager about it · بانتظار موافقة"
                    : inside.Contains(b.PrepItemId) ? BulkSwapRules.MadeFromItself(item.Name, to.Name)
                    : !canApprove ? BulkSwapRules.PrepItemsManagers
                    : null;
                return (Batch: b, Item: item, Blocked: blocked);
            })
            .ToList();
        var chosenPrep = prepRows.Where(r => r.Blocked is null && (request.PrepItemIds is null || request.PrepItemIds.Contains(r.Batch.PrepItemId)))
            .Select(r => r.Batch.PrepItemId).ToHashSet();
        foreach (var id in chosenPrep)
            swappedBatches[id].SwapIngredient(from, to, request.Ratio);

        var actualCosts = new RecipeCosts(data.Materials, actualBatches.Values);
        var swappedCosts = new RecipeCosts(data.Materials, swappedBatches.Values, actualCosts);
        var swappedData = data with { Costs = swappedCosts };
        // Made already: its cost moves with its next batches.
        bool Made(Guid prepItemId) => data.Materials.GetValueOrDefault(prepItemId)?.AverageCost > 0;
        var changedPrep = chosenPrep.ToHashSet();

        var rows = new List<SwapPreviewRow>();
        var direct = data.AllRecipes.Where(r => !r.IsDeleted && r.Ingredients.Any(i => i.RawMaterialId == from.Id)).ToList();
        var directIds = direct.Select(r => r.Id).ToList();
        var copies = (await db.Recipes.AsNoTracking().Include(r => r.Ingredients).Where(r => directIds.Contains(r.Id)).ToListAsync(cancellationToken))
            .ToDictionary(r => r.Id);
        foreach (var recipe in direct)
        {
            var line = recipe.Ingredients.Single(i => i.RawMaterialId == from.Id);
            var copy = copies[recipe.Id];
            var merged = copy.Ingredients.Any(i => i.RawMaterialId == to.Id);
            var newQuantity = copy.SwapIngredient(from, to, request.Ratio)!.Value;

            var (before, after) = (Card(recipe, data), Card(copy, swappedData));
            var blocked = pending.TryGetValue(recipe.Id, out var by) ? $"{by} has asked a manager about it · بانتظار موافقة" : null;
            var selected = blocked is null && (request.RecipeIds is null || request.RecipeIds.Contains(recipe.Id));
            rows.Add(new SwapPreviewRow(
                recipe.IsLinked ? WhereUsedKind.Dish : WhereUsedKind.OffMenuRecipe, recipe.Id, before.Recipe, before.ItemCode == "" ? null : before.ItemCode,
                before.Category, recipe.Portions, null, line.Quantity, newQuantity, merged, before.CostPerPortion, after.CostPerPortion,
                Money(after.CostPerPortion - before.CostPerPortion), before.MenuPrice, before.FoodCostPercentActual, after.FoodCostPercentActual,
                selected, blocked, Through(recipe.Ingredients.Select(i => i.RawMaterialId), changedPrep, actualBatches).Any(Made)));
        }

        foreach (var (batch, item, blocked) in prepRows)
        {
            var line = batch.Ingredients.Single(i => i.RawMaterialId == from.Id);
            var merged = batch.Ingredients.Any(i => i.RawMaterialId == to.Id);
            var swapped = chosenPrep.Contains(batch.PrepItemId) ? swappedBatches[batch.PrepItemId] : Swapped(batch.PrepItemId);
            var newQuantity = IngredientSwap.Quantity(line.Quantity, request.Ratio);
            var (before, after) = (Money(actualCosts.Batch(batch).Cost), Money(swappedCosts.Batch(swapped).Cost));
            var category = batch.RecipeCategoryId is { } c ? data.Categories.GetValueOrDefault(c)?.Name : null;
            rows.Add(new SwapPreviewRow(
                WhereUsedKind.PrepItem, batch.PrepItemId, item.Name, item.Code, category, null, batch.BatchQuantity, line.Quantity, newQuantity, merged,
                before, after, Money(after - before), null, null, null, chosenPrep.Contains(batch.PrepItemId), blocked, Made(batch.PrepItemId)));
        }

        // The dishes not swapped themselves whose cost moves through a prep item chosen.
        var swappedDishes = rows.Where(r => r.Kind != WhereUsedKind.PrepItem && r.Selected).Select(r => r.Id).ToHashSet();
        var knockOn = new List<SwapKnockOn>();
        if (changedPrep.Count > 0)
        {
            foreach (var recipe in data.AllRecipes.Where(r => !r.IsDeleted && !swappedDishes.Contains(r.Id)))
            {
                var via = Through(recipe.Ingredients.Select(i => i.RawMaterialId), changedPrep, actualBatches).ToList();
                if (via.Count == 0)
                    continue;
                var (before, after) = (Card(recipe, data), Card(recipe, swappedData));
                knockOn.Add(new SwapKnockOn(
                    recipe.IsLinked ? WhereUsedKind.Dish : WhereUsedKind.OffMenuRecipe, recipe.Id, before.Recipe, before.ItemCode == "" ? null : before.ItemCode,
                    via.Select(id => data.Materials[id].Name).OrderBy(n => n).ToList(), before.CostPerPortion, after.CostPerPortion,
                    Money(after.CostPerPortion - before.CostPerPortion), before.MenuPrice, before.FoodCostPercentActual, after.FoodCostPercentActual,
                    via.Any(Made)));
            }
        }

        return new SwapPreview(
            Item(from, actualCosts), Item(to, actualCosts), request.Ratio, from.Unit != to.Unit,
            rows.OrderBy(r => r.Kind == WhereUsedKind.PrepItem).ThenBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase).ToList(),
            knockOn.OrderBy(k => k.Name, StringComparer.CurrentCultureIgnoreCase).ToList());

        // A prep item not chosen, as it would be swapped on its own: for its row.
        PrepRecipe Swapped(Guid prepItemId)
        {
            var copy = new PrepRecipe(data.Materials[prepItemId], actualBatches[prepItemId].BatchQuantity);
            copy.Replace(actualBatches[prepItemId].Ingredients.Select(i => (data.Materials[i.RawMaterialId], i.Quantity, (decimal?)i.YieldPercent)).ToList());
            copy.SwapIngredient(from, to, request.Ratio);
            return copy;
        }
    }

    private static SwapItem Item(RawMaterial m, RecipeCosts costs) =>
        new(m.Id, m.Name, m.Code, m.IsPrepItem, m.Unit, m.PurchaseUnit, m.PurchaseUnitSize, costs.Of(m.Id).PerUnit);

    private static decimal? ItemCost(decimal quantity, decimal? perUnit) => perUnit is { } p ? Money(quantity * p) : null;

    // The prep items among `ingredients`, at any depth, that are in `changed`.
    private static IEnumerable<Guid> Through(IEnumerable<Guid> ingredients, IReadOnlySet<Guid> changed, IReadOnlyDictionary<Guid, PrepRecipe> batches)
    {
        var found = new HashSet<Guid>();
        foreach (var ingredient in ingredients)
            foreach (var id in BulkSwapRules.MadeFrom(ingredient, batches))
                if (changed.Contains(id))
                    found.Add(id);
        return found;
    }

    // A recipe's or batch's use of the item: on it (as written), inside its prep items (as
    // purchased), and the prep items it is inside.
    private static (decimal? Direct, decimal? Through, IReadOnlyList<string> Via) Uses(
        IEnumerable<(Guid Material, decimal Quantity, decimal AsPurchased)> lines, Guid itemId, PrepContents inside, IReadOnlyDictionary<Guid, RawMaterial> materials)
    {
        decimal? direct = null, through = null;
        var via = new List<string>();
        foreach (var (material, quantity, asPurchased) in lines)
        {
            if (material == itemId)
            {
                direct = (direct ?? 0) + quantity;
                continue;
            }
            var perUnit = inside.PerUnit(material);
            if (perUnit is not > 0)
                continue;
            through = (through ?? 0) + asPurchased * perUnit.Value;
            via.Add(materials.GetValueOrDefault(material)?.Name ?? "A prep item");
        }
        return (direct, through is { } t ? Math.Round(t, 3) : null, via.Distinct().OrderBy(n => n).ToList());
    }

    // How much of one item a unit of each prep item takes, as purchased, through its batch and the
    // prep items inside it.
    private sealed class PrepContents(IReadOnlyDictionary<Guid, PrepRecipe> batches, Guid itemId)
    {
        private readonly Dictionary<Guid, decimal?> _known = [];
        private readonly HashSet<Guid> _working = [];

        public decimal? PerUnit(Guid prepItemId)
        {
            if (_known.TryGetValue(prepItemId, out var known))
                return known;
            if (batches.GetValueOrDefault(prepItemId) is not { BatchQuantity: > 0 } batch || !_working.Add(prepItemId))
                return null;
            decimal? total = null;
            foreach (var ingredient in batch.Ingredients)
            {
                var each = ingredient.RawMaterialId == itemId ? 1 : PerUnit(ingredient.RawMaterialId);
                if (each is > 0)
                    total = (total ?? 0) + ingredient.AsPurchasedQuantity * each.Value / batch.BatchQuantity;
            }
            _working.Remove(prepItemId);
            return _known[prepItemId] = total;
        }
    }
}
```


#### تقرير وجبات العاملين والضيافة

كل يوم: وجبات العاملين والضيافة والتجارب بتكلفتها (المتوسط وقت الأخذ)، مقابل **حد الوجبات اليومي** من إعدادات التكاليف (`DailyStaffMealBudget`). والأثر المحاسبي في مكانه: `KpiService` يضيف الوجبات للأجور (حين تكون الأجور معروفة) والضيافة والتجارب للمصروفات، و `BurdenedCostService` يضيف الوجبات لوعاء العمالة والضيافة لوعاء التشغيل، فتصل لنقطة التعادل اليومية أيضًا.

> 📄 **`backend/src/Costing.Infrastructure/Reports/StaffMealsService.cs`** — 92 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.RawMaterials;
using Costing.Domain.StockMovements;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// Staff meals, hospitality and recipe tastings (وجبات العاملين والضيافة) over a period: each entry
// with what it took and its cost at the average when taken, each day's total against the daily
// staff meal budget, and the period's total of each.
public sealed record StaffMealLine(Guid RawMaterialId, string Material, string PurchaseUnit, decimal Quantity, decimal? Value, string? Note);

public sealed record StaffMealEntry(
    Guid EntryId, StockMovementReason Kind, DateOnly Date, DateTime RecordedAtUtc, string? RecordedBy, string? Note, IReadOnlyList<StaffMealLine> Lines,
    decimal Value);

// A day: what each kind came to, and whether the staff meals passed the budget.
public sealed record StaffMealDay(DateOnly Date, decimal StaffMeals, decimal Hospitality, decimal RecipeTasting, bool OverBudget);

public sealed record StaffMealReport(
    DateOnly From,
    DateOnly To,
    decimal? DailyBudget,
    decimal StaffMeals,
    decimal Hospitality,
    decimal RecipeTasting,
    int DaysOverBudget,
    IReadOnlyList<StaffMealDay> Days,
    IReadOnlyList<StaffMealEntry> Entries);

public sealed class StaffMealsService(CostingDbContext db, IBusinessCalendar clock)
{
    public async Task<StaffMealReport> GetAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last. · اليوم الأول قبل الأخير.");
        if (to > from.AddYears(1))
            throw new DomainException("Choose a year at most. · سنة على الأكثر.");
        var (fromUtc, _) = clock.Bounds(from);
        var (_, toUtc) = clock.Bounds(to);
        var reasons = StaffConsumption.Reasons;
        var movements = await db.StockMovements.AsNoTracking()
            .Where(m => reasons.Contains(m.Reason) && m.ReversalOf == null && m.OccurredAtUtc >= fromUtc && m.OccurredAtUtc < toUtc)
            .ToListAsync(cancellationToken);
        var sources = movements.Select(m => m.SourceId).Distinct().ToList();
        var voided = (await db.StockMovements.AsNoTracking()
                .Where(m => reasons.Contains(m.Reason) && m.ReversalOf != null && sources.Contains(m.SourceId))
                .Select(m => m.SourceId).Distinct().ToListAsync(cancellationToken))
            .ToHashSet();
        var ids = movements.Select(m => m.RawMaterialId).Distinct().ToList();
        var materials = await db.RawMaterials.AsNoTracking().Where(m => ids.Contains(m.Id)).ToDictionaryAsync(m => m.Id, cancellationToken);
        var settings = await db.CostingSettings.AsNoTracking().SingleOrDefaultAsync(cancellationToken) ?? new CostingSettings();

        var entries = movements
            .Where(m => !voided.Contains(m.SourceId))
            .GroupBy(m => m.SourceId)
            .Select(g =>
            {
                var lines = g.Select(m =>
                    {
                        var material = materials.GetValueOrDefault(m.RawMaterialId);
                        var size = material?.PurchaseUnitSize ?? 1;
                        return new StaffMealLine(
                            m.RawMaterialId, material?.Name ?? "A removed material", material?.PurchaseUnit ?? "", Math.Round(-m.Quantity / size, 3),
                            m.UnitCost is { } cost ? Money(-m.Quantity * cost) : null, m.Note);
                    })
                    .OrderBy(l => l.Material, StringComparer.CurrentCultureIgnoreCase)
                    .ToList();
                var first = g.MinBy(m => m.OccurredAtUtc)!;
                return new StaffMealEntry(
                    g.Key, first.Reason, clock.BusinessDateOf(first.OccurredAtUtc), first.OccurredAtUtc, first.RecordedBy,
                    lines.Select(l => l.Note).FirstOrDefault(n => n is not null), lines, Money(lines.Sum(l => l.Value ?? 0)));
            })
            .OrderByDescending(e => e.RecordedAtUtc)
            .ToList();

        decimal Of(IEnumerable<StaffMealEntry> those, StockMovementReason kind) => Money(those.Where(e => e.Kind == kind).Sum(e => e.Value));
        var budget = settings.DailyStaffMealBudget;
        var days = entries.GroupBy(e => e.Date)
            .Select(g => new StaffMealDay(
                g.Key, Of(g, StockMovementReason.StaffMeal), Of(g, StockMovementReason.Hospitality), Of(g, StockMovementReason.RecipeTasting),
                budget is { } b && Of(g, StockMovementReason.StaffMeal) > b))
            .OrderByDescending(d => d.Date)
            .ToList();
        return new StaffMealReport(
            from, to, budget, Of(entries, StockMovementReason.StaffMeal), Of(entries, StockMovementReason.Hospitality),
            Of(entries, StockMovementReason.RecipeTasting), days.Count(d => d.OverBudget), days, entries);
    }
}
```


### 4.4 تحليل الإنفاق ودفتر المبيعات

`PurchaseSpendingService`: أين ذهب المال (مخزون مقابل مصروفات، ثم بالفئة)، وسجل مشتريات الصنف (كل بند فاتورة اشترى الخامة)، والمصروفات المسجلة. و `SalesLedger`: المبيعات من أي مصدر بصيغة واحدة للتقارير.

> 📄 **`backend/src/Costing.Infrastructure/Reports/PurchaseSpendingService.cs`** — 244 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Categories;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Common;
using Costing.Infrastructure.Persistence;
using static Costing.Infrastructure.Reports.CostingService;

namespace Costing.Infrastructure.Reports;

// One material or expense item's purchases in the period. Quantity is in what the item is bought
// in (kg, carton) for a material, and as entered for an expense; Unit names it.
public sealed record ItemSpending(PurchaseItemType ItemType, Guid ItemId, string Name, decimal Quantity, string Unit, decimal Total, int Lines);

// A category's purchases: what went into stock, what was expenses, and its share of the whole.
public sealed record CategorySpending(
    Guid CategoryId,
    string Category,
    string? CategoryAr,
    ExpenseLine ExpenseLine,
    decimal Inventory,
    decimal Expenses,
    decimal Total,
    decimal? SharePercent,
    IReadOnlyList<ItemSpending> Items);

// Purchases by category over a period, from the posted invoices: each invoice on its own date, or
// on the day it was posted when it has none; and the expense vouchers paid from the safe, each on
// its date. Lines with no price are counted, not valued.
public sealed record SpendingReport(
    DateOnly From,
    DateOnly To,
    decimal Total,
    decimal Inventory,
    decimal Expenses,
    int Invoices,
    int UnpricedLines,
    IReadOnlyList<CategorySpending> Categories,
    int Vouchers = 0);

// One invoice line that bought a material, as its paper has it: Quantity in the unit billed (5 kg),
// BaseQuantity in the material's own (5,000 g), UnitPrice per unit billed. Voided: the invoice no
// longer stands, and ReplacedBy names the one that corrected it, if one did; RevisionOf, the one
// it corrected.
public sealed record MaterialPurchase(
    Guid InvoiceId,
    DateOnly Date,
    string? Supplier,
    string? InvoiceNumber,
    decimal Quantity,
    string Unit,
    decimal BaseQuantity,
    decimal? UnitPrice,
    decimal? Total,
    bool Voided,
    Guid? ReplacedBy,
    Guid? RevisionOf);

// A material's purchase history card (كارت الصنف): every posted or voided invoice line that bought
// it, newest first, to hold against the paper invoices. The totals are the standing invoices'
// only: what came in, what it cost, and the average paid per purchase unit, over the priced lines.
public sealed record MaterialPurchaseHistory(
    Guid MaterialId,
    string Material,
    UnitOfMeasure Unit,
    string PurchaseUnit,
    decimal PurchaseUnitSize,
    IReadOnlyList<MaterialPurchase> Lines,
    decimal BaseQuantity,
    decimal Total,
    decimal? AveragePerPurchaseUnit,
    int UnpricedLines);

// What a period's expense lines came to in one category, for the profit and loss.
public sealed record LoggedExpense(Guid CategoryId, string Category, string? CategoryAr, ExpenseLine ExpenseLine, decimal Amount);

// Purchases added up by category: the Purchases by Category report, and the logged expenses the
// KPIs and the break-even worksheet take off as overheads. Each line is filed under its item's
// category as it is now, so moving an item to the right category puts its history right too.
public sealed class PurchaseSpendingService(CostingDbContext db, IBusinessCalendar clock)
{
    // InvoiceId: the invoice's, or an expense voucher's (IsVoucher).
    private sealed record PostedLine(
        Guid InvoiceId, PurchaseItemType ItemType, Guid ItemId, string Name, PurchaseCategory? Category, decimal Quantity, string Unit, decimal? Cost,
        bool IsVoucher = false);

    public async Task<SpendingReport> GetAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        if (to < from)
            throw new DomainException("The first day must come before the last.");
        if (to > from.AddYears(5))
            throw new DomainException("Choose five years at most.");

        var lines = await PostedLinesAsync(from, to, cancellationToken);
        var priced = lines.Where(l => l.Cost is not null).ToList();
        var total = priced.Sum(l => l.Cost!.Value);
        var categories = priced
            .GroupBy(l => l.Category?.Id ?? PurchaseCategory.GeneralId)
            .Select(g =>
            {
                var category = g.First().Category;
                var inventory = g.Where(l => l.ItemType == PurchaseItemType.Inventory).Sum(l => l.Cost!.Value);
                var expenses = g.Where(l => l.ItemType == PurchaseItemType.Expense).Sum(l => l.Cost!.Value);
                return new CategorySpending(
                    g.Key, category?.Name ?? PurchaseCategory.GeneralName, category?.NameAr, category?.ExpenseLine ?? ExpenseLine.Controllable,
                    Money(inventory), Money(expenses), Money(inventory + expenses),
                    total > 0 ? Percent((inventory + expenses) / total) : null,
                    g.GroupBy(l => (l.ItemType, l.ItemId))
                        .Select(i => new ItemSpending(
                            i.Key.ItemType, i.Key.ItemId, i.First().Name, Math.Round(i.Sum(l => l.Quantity), 3), i.First().Unit,
                            Money(i.Sum(l => l.Cost!.Value)), i.Count()))
                        .OrderByDescending(i => i.Total)
                        .ThenBy(i => i.Name, StringComparer.CurrentCultureIgnoreCase)
                        .ToList());
            })
            .OrderByDescending(c => c.Total)
            .ThenBy(c => c.Category, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        return new SpendingReport(
            from, to, Money(total),
            Money(priced.Where(l => l.ItemType == PurchaseItemType.Inventory).Sum(l => l.Cost!.Value)),
            Money(priced.Where(l => l.ItemType == PurchaseItemType.Expense).Sum(l => l.Cost!.Value)),
            lines.Where(l => !l.IsVoucher).Select(l => l.InvoiceId).Distinct().Count(),
            lines.Count - priced.Count,
            categories,
            lines.Count(l => l.IsVoucher));
    }

    // The period's expense lines by category: overheads for the profit and loss. Stock lines are
    // left out; they are cost of sales once the recipes use them.
    public async Task<IReadOnlyList<LoggedExpense>> LoggedExpensesAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken) =>
        (await PostedLinesAsync(from, to, cancellationToken))
            .Where(l => l.ItemType == PurchaseItemType.Expense && l.Cost is not null)
            .GroupBy(l => l.Category?.Id ?? PurchaseCategory.GeneralId)
            .Select(g => new LoggedExpense(
                g.Key, g.First().Category?.Name ?? PurchaseCategory.GeneralName, g.First().Category?.NameAr,
                g.First().Category?.ExpenseLine ?? ExpenseLine.Controllable, Money(g.Sum(l => l.Cost!.Value))))
            .OrderByDescending(e => e.Amount)
            .ToList();

    // Every line that bought the material, from posted and voided invoices (a draft has bought
    // nothing yet), each dated as the reports date it: by the invoice, or the day it was posted.
    public async Task<MaterialPurchaseHistory> MaterialHistoryAsync(Guid materialId, CancellationToken cancellationToken)
    {
        var material = await db.RawMaterials.AsNoTracking().SingleOrDefaultAsync(m => m.Id == materialId, cancellationToken)
            ?? throw new NotFoundException("Raw material", materialId);
        var bought = await db.PurchaseInvoices.AsNoTracking()
            .Where(i => (i.Status == PurchaseInvoiceStatus.Posted || i.Status == PurchaseInvoiceStatus.Voided)
                && i.Lines.Any(l => l.RawMaterialId == materialId))
            .Select(i => new
            {
                i.Id, i.SupplierId, i.SupplierInvoiceNumber, i.InvoiceDate, i.PostedAtUtc, i.CreatedAtUtc, i.Status, i.ReplacedBy, i.RevisionOf,
                Lines = i.Lines.Where(l => l.RawMaterialId == materialId).ToList(),
            })
            .ToListAsync(cancellationToken);
        var supplierIds = bought.Where(i => i.SupplierId != null).Select(i => i.SupplierId!.Value).Distinct().ToList();
        var suppliers = await db.Suppliers.AsNoTracking().Where(s => supplierIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken);

        var lines = bought
            .SelectMany(i => i.Lines.Select(l => new
            {
                Posted = i.PostedAtUtc ?? i.CreatedAtUtc,
                Line = new MaterialPurchase(
                    i.Id, i.InvoiceDate ?? clock.BusinessDateOf(i.PostedAtUtc ?? i.CreatedAtUtc),
                    i.SupplierId is { } supplier ? suppliers.GetValueOrDefault(supplier) : null, i.SupplierInvoiceNumber,
                    l.EnteredQuantity, l.UnitLabel, l.Quantity,
                    l.Cost is { } cost && l.EnteredQuantity > 0 ? Math.Round(cost / l.EnteredQuantity, 4, MidpointRounding.AwayFromZero) : null,
                    l.Cost, i.Status == PurchaseInvoiceStatus.Voided, i.ReplacedBy, i.RevisionOf),
            }))
            .OrderByDescending(l => l.Line.Date)
            .ThenByDescending(l => l.Posted)
            .Select(l => l.Line)
            .ToList();

        var standing = lines.Where(l => !l.Voided).ToList();
        var priced = standing.Where(l => l.Total is not null).ToList();
        var pricedQuantity = priced.Sum(l => l.BaseQuantity);
        return new MaterialPurchaseHistory(
            material.Id, material.Name, material.Unit, material.PurchaseUnit, material.PurchaseUnitSize, lines,
            Math.Round(standing.Sum(l => l.BaseQuantity), 3), Money(priced.Sum(l => l.Total!.Value)),
            pricedQuantity > 0 ? Money(priced.Sum(l => l.Total!.Value) / pricedQuantity * material.PurchaseUnitSize) : null,
            standing.Count - priced.Count);
    }

    private async Task<IReadOnlyList<PostedLine>> PostedLinesAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        var (fromUtc, _) = clock.Bounds(from);
        var (_, toUtc) = clock.Bounds(to);
        var invoices = await db.PurchaseInvoices.AsNoTracking().Include(i => i.Lines)
            .Where(i => i.Status == PurchaseInvoiceStatus.Posted
                && ((i.InvoiceDate != null && i.InvoiceDate >= from && i.InvoiceDate <= to)
                    || (i.InvoiceDate == null && i.PostedAtUtc >= fromUtc && i.PostedAtUtc < toUtc)))
            .ToListAsync(cancellationToken);
        // Expense vouchers that stand: a voided one leaves the reports of its own date.
        var vouchers = await db.SafeTransactions.AsNoTracking()
            .Where(t => t.Kind == SafeTransactionKind.ExpenseVoucher && t.ReversalOf == null && t.VoidedAtUtc == null
                && t.BusinessDate >= from && t.BusinessDate <= to)
            .Select(t => new { t.Id, t.ExpenseItemId, t.Amount })
            .ToListAsync(cancellationToken);
        if (invoices.Count == 0 && vouchers.Count == 0)
            return [];

        var categories = await db.PurchaseCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, cancellationToken);
        var materials = await db.RawMaterials.AsNoTracking()
            .Select(m => new { m.Id, m.Name, m.CategoryId, m.PurchaseUnit, m.PurchaseUnitSize })
            .ToDictionaryAsync(m => m.Id, cancellationToken);
        var expenses = await db.ExpenseItems.AsNoTracking()
            .Select(e => new { e.Id, e.Name, e.CategoryId, e.Unit })
            .ToDictionaryAsync(e => e.Id, cancellationToken);

        var paidOut = vouchers.Select(v =>
        {
            var expense = expenses.GetValueOrDefault(v.ExpenseItemId!.Value);
            return new PostedLine(
                v.Id, PurchaseItemType.Expense, v.ExpenseItemId.Value, expense?.Name ?? "A removed expense",
                expense is null ? null : categories.GetValueOrDefault(expense.CategoryId), 1, expense?.Unit ?? "voucher", -v.Amount, IsVoucher: true);
        });

        return invoices
            .SelectMany(i => i.Lines.Select(l =>
            {
                if (l.ItemType == PurchaseItemType.Expense)
                {
                    var expense = expenses.GetValueOrDefault(l.ExpenseItemId!.Value);
                    return new PostedLine(
                        i.Id, l.ItemType, l.ExpenseItemId.Value, expense?.Name ?? "A removed expense",
                        expense is null ? null : categories.GetValueOrDefault(expense.CategoryId),
                        l.EnteredQuantity, expense?.Unit ?? l.UnitLabel, l.Cost);
                }

                var material = materials.GetValueOrDefault(l.RawMaterialId!.Value);
                return new PostedLine(
                    i.Id, l.ItemType, l.RawMaterialId.Value, material?.Name ?? "A removed material",
                    material is null ? null : categories.GetValueOrDefault(material.CategoryId),
                    material is null ? l.Quantity : l.Quantity / material.PurchaseUnitSize, material?.PurchaseUnit ?? l.UnitLabel, l.Cost);
            }))
            .Concat(paidOut)
            .ToList();
    }
}
```


> 📄 **`backend/src/Costing.Infrastructure/Reports/SalesLedger.cs`** — 61 سطر

```csharp
using Microsoft.EntityFrameworkCore;
using Costing.Domain.Sales;
using Costing.Infrastructure.Persistence;

namespace Costing.Infrastructure.Reports;

// One sale, wherever it was rung up. DeliveryFee is after any delivery discount; BilledSubtotal
// is what the promo discount was taken from.
public sealed record SaleOrder(bool Online, decimal DiscountAmount, decimal BilledSubtotal, decimal DeliveryFee, IReadOnlyList<SaleLine> Lines)
{
    // For the reconciliation of each day's cash: when it was paid and how, what was charged, and
    // the parts of that which are not the food: tax, the points it was paid with, money handed
    // back. An online sale has no refunds: one refunded before the till saw it paid is no sale.
    public DateTime SoldAtUtc { get; init; }
    public PaymentMethod PaymentMethod { get; init; }
    public decimal Charged { get; init; }
    public decimal Tax { get; init; }
    public decimal Points { get; init; }
    public decimal Refunded { get; init; }

    // The business day it counts on: a day's sales summary, the day it is for.
    public DateOnly BusinessDate { get; init; }
}

// OnBill: still charged. A line refunded after payment was sold, and took its stock; one voided
// before payment never was.
public sealed record SaleLine(
    Guid PublicId, int MenuItemId, int? VariantId, string MenuItemName, string? VariantName, int Quantity, decimal LineTotal,
    IReadOnlyList<int> AddOnIds, bool OnBill, int? PostedQuantity = null)
{
    // The part of what it took that is still sold: all of it, unless part of the line was refunded.
    public decimal PostedShare => PostedQuantity is > 0 and var posted && posted != Quantity ? (decimal)Quantity / posted : 1;
}

// Every sale in a period for the cost reports: the receipts entered or imported on the Sales tab,
// by when they were paid, voided ones left out. From inclusive, to exclusive.
public sealed class SalesLedger(CostingDbContext db)
{
    public async Task<IReadOnlyList<SaleOrder>> GetAsync(DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        var receipts = await db.SalesReceipts.AsNoTracking()
            .Where(r => r.VoidedAtUtc == null && r.SoldAtUtc >= fromUtc && r.SoldAtUtc < toUtc)
            .ToListAsync(cancellationToken);

        return receipts.Select(r => new SaleOrder(
                r.IsOnline, r.DiscountAmount, r.BilledSubtotal, r.DeliveryFee,
                r.Lines.Select(l => new SaleLine(
                    l.PublicId, l.MenuItemId, l.VariantId, l.MenuItemName, l.VariantName, l.Quantity, l.LineTotal, l.AddOnIds, l.OnBill, l.PostedQuantity))
                    .ToList())
            {
                SoldAtUtc = r.SoldAtUtc,
                PaymentMethod = r.PaymentMethod,
                Charged = r.TotalAmount,
                Tax = r.TaxAmount,
                Points = r.PointsAmount,
                Refunded = r.RefundedAmount,
                BusinessDate = r.BusinessDate,
            })
            .ToList();
    }
}
```


[الفصل التالي: محركات الإكسيل والربط →](07-excel-engines-and-ecosystem-links.md)
