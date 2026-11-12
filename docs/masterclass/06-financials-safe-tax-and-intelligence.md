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

> 📄 **`backend/src/Costing.Application/Treasury/Treasury.cs`** — 757 سطر

```csharp
using System.Globalization;
using MediatR;
using Costing.Domain.Common;
using Costing.Domain.Staff;
using Costing.Application.Approvals;
using Costing.Application.Common;
using Costing.Domain.Approvals;
using Costing.Domain.Expenses;
using Costing.Domain.Purchases;
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
    Guid? PayrollRunId = null);

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
    decimal NetAmount = 0)
{
    public static SafeTransactionDto From(SafeTransaction t) => new(
        t.Id, t.Kind, t.Fund, t.Amount, t.BusinessDate, t.RevenueDate, t.Source, t.SupplierId, t.PurchaseInvoiceId, t.ExpenseItemId, t.Notes,
        t.RecordedBy, t.RecordedAtUtc, t.ApprovedBy, t.ReversalOf, t.VoidedAtUtc, t.VoidedBy, t.IncludesTax, t.TaxPercent, t.TaxAmount,
        t.GrossAmount, t.EmployeeId, t.PayrollMonth, t.CardAmount, t.VoidsAmount, t.Kind == SafeTransactionKind.RevenueTransfer ? t.NetAmount : 0);
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
    Costing.Application.Integrations.HrOutbox hr)
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    // Invoices posted in this unit of work, not saved yet: read from here, not the database.
    private readonly Dictionary<Guid, PurchaseInvoice> _posting = [];

    // The business day: the one cash belongs to, as the day report counts it. Between midnight
    // and the hour the business day starts, the restaurant's calendar is a day ahead of it; an
    // entry dated that calendar day is taken as well (Latest), never one later.
    public DateOnly Today => descriptions.BusinessDateOf(DateTime.UtcNow);

    private DateOnly Latest
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
        if (voucher.Kind != SafeTransactionKind.RevenueTransfer && (voucher.CardAmount is not null || voucher.TaxAmount is not null || voucher.VoidsAmount is not null))
            throw new DomainException("Only a day's takings have card takings, tax and voids.");
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
                    voucher.CardAmount ?? 0, voucher.TaxAmount, voucher.VoidsAmount ?? 0);
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
            default:
                throw new DomainException("Say what the safe entry is.");
        }

        safe.Add(entry);
        return entry;
    }

    // Voids it, today: the opposite amount in the safe's ledger, and on the supplier's account too
    // for a supplier payment. A payment out of a day's takings goes back into the safe when they
    // are in it.
    public async Task VoidAsync(SafeTransaction entry, string by, CancellationToken cancellationToken)
    {
        safe.Add(entry.Void(Guid.NewGuid(), Today, by, await TakingsInSafeAsync(entry.RevenueDate, cancellationToken)));
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
            SafeTransactionKind.OpeningBalance or SafeTransactionKind.Funding => voucher.Amount,
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

> 📄 **`backend/src/Costing.Infrastructure/Reports/TreasuryService.cs`** — 939 سطر

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
    decimal TaxOwedNow = 0);

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
            Money(before + cash + card + tax + funding),
            Money(Out(standing)),
            (await GetTaxPositionAsync(null, cancellationToken)).Owed);
    }

    // All that went out of the safe in these entries: what was paid from it (a voided payment's void
    // taking it back), and what the takings had paid straight out of them before they went in.
    private static decimal Out(IEnumerable<SafeTransaction> entries) =>
        entries.Sum(t => t.Kind switch
        {
            SafeTransactionKind.RevenueTransfer => t.TakingsTotal - t.Amount,
            SafeTransactionKind.OpeningBalance or SafeTransactionKind.Funding => 0,
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

        var outgoing = standing.Where(t => t.Kind is not (SafeTransactionKind.RevenueTransfer or SafeTransactionKind.OpeningBalance or SafeTransactionKind.Funding))
            .Select(t => (Payment: t, Amount: -t.Amount))
            .Concat(paidOut)
            .ToList();

        var (cash, card, tax) = (takings.Sum(t => t.GrossAmount ?? t.Amount), takings.Sum(t => t.CardAmount), takings.Sum(t => t.TaxAmount));
        var opening = before + standing.Where(t => t.Kind == SafeTransactionKind.OpeningBalance).Sum(t => t.Amount);
        var funding = standing.Where(t => t.Kind == SafeTransactionKind.Funding).ToList();
        var totalIn = cash + card + tax + opening + funding.Sum(t => t.Amount);
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
                    SafeTransactionKind.OpeningBalance or SafeTransactionKind.Funding => t.Amount,
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
    private static (decimal Opening, decimal Credit, decimal Paid) Totals(IEnumerable<SupplierLedgerEntry> lines)
    {
        var all = lines.ToList();
        return (
            Money(all.Where(l => l.Kind == SupplierLedgerKind.OpeningBalance).Sum(l => l.Amount)),
            Money(all.Where(l => l.Kind == SupplierLedgerKind.CreditInvoice).Sum(l => l.Amount)),
            Money(-all.Where(l => l.Kind == SupplierLedgerKind.Payment).Sum(l => l.Amount)));
    }

    // The credit invoices still owed, oldest first: what was paid is set against the opening debt,
    // then against each invoice in turn.
    private static IReadOnlyList<OpenInvoice> OpenInvoices(IReadOnlyList<SupplierLedgerEntry> lines, IReadOnlyDictionary<Guid, PurchaseInvoice> invoices)
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
        IReadOnlyDictionary<Guid, string> Employees);

    private async Task<Names> NamesAsync(IReadOnlyList<SafeTransaction> rows, CancellationToken cancellationToken)
    {
        var invoiceIds = rows.Where(t => t.PurchaseInvoiceId != null).Select(t => t.PurchaseInvoiceId!.Value).Distinct().ToList();
        return new Names(
            await db.Suppliers.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, cancellationToken),
            await db.ExpenseItems.AsNoTracking().ToDictionaryAsync(e => e.Id, e => e.Name, cancellationToken),
            await db.PurchaseInvoices.AsNoTracking().Where(i => invoiceIds.Contains(i.Id))
                .ToDictionaryAsync(i => i.Id, i => i.SupplierInvoiceNumber, cancellationToken),
            await db.Staff.AsNoTracking().ToDictionaryAsync(e => e.Id, e => e.Name, cancellationToken));
    }

    private static SafeEntryRow Row(SafeTransaction t, Names names, decimal? balance)
    {
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

> 📄 **`backend/src/Costing.Api/Controllers/FinancialsController.cs`** — 162 سطر

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
public sealed class FinancialsController(ISender sender, TreasuryService treasury) : ControllerBase
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
                PayrollMonth: request.PayrollMonth, CardAmount: request.CardAmount, TaxAmount: request.TaxAmount, VoidsAmount: request.VoidsAmount),
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
    decimal? VoidsAmount = null);

public sealed record SupplierOpeningBalanceRequest(Guid EntryId, decimal Owed, DateOnly? Date = null);
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

> 📄 **`backend/src/Costing.Infrastructure/Reports/IntelligenceService.cs`** — 789 سطر

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
    Supplier = 2,
}

// The order as approved: each material's quantity in its purchase unit.
public sealed record OrderSheetLine(Guid RawMaterialId, decimal Quantity);

public sealed record OrderSheetRequest(IReadOnlyList<OrderSheetLine> Lines, OrderSheetGrouping GroupBy = OrderSheetGrouping.Category, int? CoverageDays = null);

// The approved order, for the sheet: each line with its unit price and cost, and the group it is under.
public sealed record OrderSheetRow(string Group, string? Code, string Material, string PurchaseUnit, decimal Quantity, decimal? UnitPrice, decimal? Cost, string? Other);

public sealed record OrderSheet(OrderSheetGrouping GroupBy, int? CoverageDays, DateOnly Today, IReadOnlyList<OrderSheetRow> Rows, decimal Total);

// ---- Theoretical against actual consumption ----

// One bought material over the period. Actual usage: opening + purchases − logged waste − closing,
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
    VarianceEvaluation Evaluation);

public sealed record ConsumptionReport(
    DateOnly From,
    DateOnly To,
    decimal TolerancePercent,
    decimal TheoreticalValue,
    decimal ActualValue,
    decimal UnexplainedValue,
    int HighLoss,
    IReadOnlyList<ConsumptionRow> Rows,
    IReadOnlyList<SoldWithoutStock> SoldWithoutRecipe);

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

public sealed class IntelligenceService(CostingDbContext db, IBusinessCalendar clock, SalesLedger ledger)
{
    // Class A: what the materials up to three quarters of the value are; B, the next 15%.
    public const decimal ClassALimit = 75;
    public const decimal ClassBLimit = 90;

    // Fewer days on hand than this: it runs out before the next delivery is likely in.
    public const decimal StockoutDays = 2;

    // What took stock out of use: sold, made into prep items, wasted, short at a count.
    private static readonly StockMovementReason[] Uses =
    [
        StockMovementReason.Sale, StockMovementReason.ProductionInput, StockMovementReason.Waste, StockMovementReason.Spoilage,
        StockMovementReason.VoidReturn, StockMovementReason.CountAdjustment,
    ];

    // Waste logged: spoilage, and dishes voided after the kitchen made them, less what refunds put back.
    private static readonly StockMovementReason[] WasteReasons = [StockMovementReason.Waste, StockMovementReason.Spoilage, StockMovementReason.VoidReturn];

    // A movement priced at the average cost when it was made: what the average was then.
    private static readonly StockMovementReason[] AtAverage =
    [
        StockMovementReason.Sale, StockMovementReason.Waste, StockMovementReason.VoidReturn, StockMovementReason.Spoilage,
        StockMovementReason.ProductionInput, StockMovementReason.CountAdjustment, StockMovementReason.OpeningStock,
    ];

    public DateOnly Today => clock.BusinessDateOf(DateTime.UtcNow);

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

        var rows = request.Lines.Where(l => l.Quantity > 0 && materials.ContainsKey(l.RawMaterialId))
            .GroupBy(l => l.RawMaterialId)
            .Select(g =>
            {
                var material = materials[g.Key];
                var last = prices.GetValueOrDefault(material.Id);
                var price = Money(last?.UnitCost * material.PurchaseUnitSize ?? material.CostPerPurchaseUnit);
                var quantity = g.Sum(l => l.Quantity);
                var category = categories.GetValueOrDefault(material.CategoryId) ?? "Uncategorized";
                var supplier = last?.SupplierId is { } s ? suppliers.GetValueOrDefault(s) : null;
                return request.GroupBy == OrderSheetGrouping.Supplier
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

        var rows = new List<ConsumptionRow>();
        foreach (var material in catalog.Materials.Values.Where(m => !m.IsPrepItem))
        {
            var id = material.Id;
            var (opening, purchases, closing) = (stock.Opening(id), stock.Moved(id, StockMovementReason.Purchase), stock.Closing(id));
            var waste = stock.Wasted(id) + prepWaste.GetValueOrDefault(id);
            var inPrep = held.GetValueOrDefault(id);
            var expected = theoretical.GetValueOrDefault(id) + inPrep;
            if (opening == 0 && purchases == 0 && waste == 0 && closing == 0 && expected == 0)
                continue;
            var actual = opening + purchases - waste - closing;
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
                Money(material.CostPerPurchaseUnit), Money(unexplained * material.AverageCost), evaluation));
        }

        rows = rows.OrderBy(r => r.Evaluation == VarianceEvaluation.SharedCost).ThenByDescending(r => r.VarianceCost ?? 0).ThenBy(r => r.Material).ToList();
        var measured = rows.Where(r => r.Evaluation != VarianceEvaluation.SharedCost).ToList();
        decimal Worth(Func<ConsumptionRow, decimal> quantity) => Money(measured.Sum(r => quantity(r) * (r.UnitCost ?? 0)));
        return new ConsumptionReport(
            from, to, tolerance, Worth(r => r.TheoreticalUsage), Worth(r => r.ActualUsage), Money(measured.Sum(r => r.VarianceCost ?? 0)),
            measured.Count(r => r.Evaluation == VarianceEvaluation.Unfavourable), rows,
            withoutRecipe.GroupBy(w => (w.ItemCode, w.MenuItem)).Select(g => new SoldWithoutStock(g.Key.ItemCode, g.Key.MenuItem, g.Sum(w => w.Quantity)))
                .OrderByDescending(w => w.Quantity).ToList());
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
        IReadOnlyDictionary<RecipeTarget, Target> targets)
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
                _requirements[key] = per = StockRequirements.For(key.Item(1), recipes);
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

        return new Catalog(materials, categories, recipes, prepRecipes, targets);
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

> 📄 **`backend/src/Costing.Infrastructure/Reports/StockCardService.cs`** — 310 سطر

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
        _ => StockCardMovementType.CountAdjustment,
    };

    private static StockCardSourceKind SourceOf(StockMovementReason reason) => reason switch
    {
        StockMovementReason.Purchase => StockCardSourceKind.PurchaseInvoice,
        StockMovementReason.ProductionInput or StockMovementReason.ProductionOutput => StockCardSourceKind.ProductionOrder,
        StockMovementReason.OpeningStock or StockMovementReason.CountAdjustment => StockCardSourceKind.StockCount,
        StockMovementReason.Spoilage => StockCardSourceKind.Spoilage,
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
                var details = m.Reason == StockMovementReason.Spoilage && !m.IsReversal ? m.Note : source.Details;
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
            var first = movements.First(m => m.SourceId == id && m.Reason == StockMovementReason.Spoilage);
            result[(id, StockCardSourceKind.Spoilage)] = new Source(id, clock.BusinessDateOf(first.OccurredAtUtc), "Spoilage · تالف", first.Note);
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
        _ => "Sale · فاتورة بيع",
    };

    private static decimal Quantity(decimal value) => Math.Round(value, 3, MidpointRounding.AwayFromZero);

    private static decimal? Cost(decimal? value) => value is { } v ? Math.Round(v, 4, MidpointRounding.AwayFromZero) : null;
}
```


`IntelligenceController` (`api/costing/intelligence`): التبويبات الخمسة وكل منها بشيت Excel، و `POST orders` (الخطة) و `POST orders/sheet` (ورقة الطلب). وكارتة الصنف في `CostingController`: `GET api/costing/materials/{id}/stock-card?from&to&type` وشيتها `…/stock-card/sheet`، مفتوحة لكل تبويب يعرض الخامة بسعرها أو رصيدها.

> 📄 **`backend/src/Costing.Api/Controllers/IntelligenceController.cs`** — 82 سطر

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Domain.Access;
using Costing.Api.Auth;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Api.Controllers;

// Material & demand intelligence (تحليلات الخامات والطلبيات): purchase price variance and what it does
// to the recipes, the order planner and its sheet, theoretical against actual consumption, and ABC
// with days on hand, and menu engineering. Each as a table, and as a workbook (…/sheet). Costs, so a manager's or a cost
// controller's view; nothing here changes anything.
[ApiController]
[Route("api/costing/intelligence")]
[Authorize(Policy = Permissions.InventoryView)]
[CostingTab(CostingTabs.Intelligence)]
public sealed class IntelligenceController(IntelligenceService intelligence, CostingService costing) : ControllerBase
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
}
```


### 3.5 تقرير الفروقات بين جردين

> 📄 **`backend/src/Costing.Infrastructure/Reports/VarianceService.cs`** — 273 سطر

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
    VarianceEvaluation Evaluation);

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
    IReadOnlyList<string> MissingPrices);

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
         StockMovementReason.ProductionInput, StockMovementReason.ProductionOutput];

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
            // What the sales took by their recipes, and what production took by the prep items'.
            var standard = standardBy.GetValueOrDefault(id) - Flow(id, StockMovementReason.ProductionInput);
            var expected = open + received - rawWaste - productWaste - standard;
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
                unitCost, Money(variance * unitCost), Money(unexplained * unitCost), evaluation));
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
            rows.Where(r => r.UnitCost is null).Select(r => r.Material).ToList());
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
المصروفات القابلة للتحكم، الإشغال، الفوائد، الإهلاك = المدخلة شهريًا + فواتير المصروفات المسجلة بفئاتها
صافي الربح          = مجمل الربح − كل المصروفات
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

> 📄 **`backend/src/Costing.Infrastructure/Reports/KpiService.cs`** — 310 سطر

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
    decimal SalesAtMenuPrices = 0);

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
    decimal SalesWithoutRecipe);

// Pillar 4: the template's financial KPIs for a business month. Sales and recipe costs come
// from the till; losses from the stock ledger; wages, hours and overheads from what the manager
// enters for the month.
public sealed class KpiService(CostingDbContext db, IBusinessCalendar clock, CostingService costing, SalesLedger ledger, PurchaseSpendingService spending)
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
        // Known once entered or paid: wages as entered plus wages paid as expenses.
        decimal? wages = expenses?.WagesAndBenefits is null && loggedWages == 0 ? null : (expenses?.WagesAndBenefits ?? 0) + loggedWages;
        var totalExpenses = (wages ?? 0) + (expenses?.OtherControllableCosts ?? 0) + (expenses?.OccupationCost ?? 0)
            + (expenses?.Interest ?? 0) + (expenses?.Depreciation ?? 0) + loggedControllable + loggedOccupation + loggedOtherFixed;
        decimal? netProfit = wages is not null ? grossProfit - totalExpenses : null;
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
                takingsDays, Money(soldAtMenuPrices)),
            ToDto(expenses), kpis, items,
            withoutRecipe.Count, withoutRecipe.Sum(r => r.NetSales));
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


### 4.3 نقطة التعادل وسيناريوهاتها

```text
المبيعات السنوية    = المبيعات الأسبوعية × 52
تكلفة المبيعات      = بنسبة الأشهر المختارة نفسها (غير مقرّبة)
التكاليف الثابتة    = (المدخلة شهريًا + فواتير المصروفات المسجلة) ، متوسط الأشهر التي فيها تكاليف × 12
هامش الربح          = 1 − (التكلفة المتغيرة ÷ المبيعات)
نقطة التعادل        = التكاليف الثابتة ÷ هامش الربح   (null إن كان كل بيع خاسرًا)
```

وأربعة سيناريوهات للمبيعات الأسبوعية تُحفظ للمرة القادمة.

> 📄 **`backend/src/Costing.Infrastructure/Reports/BreakEvenService.cs`** — 130 سطر

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
                && logged == 0)
            {
                withoutCosts.Add(month.ToString("MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture));
                continue;
            }
            withCosts++;
            controllable += (e.WagesAndBenefits ?? 0) + (e.OtherControllableCosts ?? 0) + s.LoggedControllableCosts + s.LoggedWages;
            occupation += (e.OccupationCost ?? 0) + s.LoggedOccupationCost;
            otherFixed += s.LoggedOtherFixedCosts;
            interest += e.Interest ?? 0;
            depreciation += e.Depreciation ?? 0;
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


> 📄 **`backend/src/Costing.Infrastructure/Reports/SalesLedger.cs`** — 57 سطر

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
            })
            .ToList();
    }
}
```


[الفصل التالي: محركات الإكسيل والربط →](07-excel-engines-and-ecosystem-links.md)
