using System.Globalization;
using Costing.Domain.Common;

namespace Costing.Domain.Staff;

public enum PayrollRunStatus
{
    // Approved on HR and sent here: owed to the staff, to be paid out of the safe.
    Payable = 1,

    // Paid out of the safe (SafeTransactionId), and HR told so.
    Disbursed = 2,
}

// A month's payroll approved on HR and sent here (مسير رواتب معتمد), by HR's own id for it (Id, the
// idempotency key): what the work cost (LaborCost, for the profit and loss and the prime cost), how
// it was made (the base wages, what was added, the penalties) and what is still to be paid in cash
// (NetCashPayable): the pay less the advances already paid out of the safe during the month, so
// none is paid twice. By department too. Paid out of the safe as one entry (Disbursed); sent again
// as it was, nothing changes; sent changed while still to be paid, it is replaced; once paid, it
// cannot be.
public sealed class PayrollRun : AggregateRoot
{
    private readonly List<PayrollRunDepartment> _departments = [];

    private PayrollRun() { }

    public PayrollRun(Guid id, DateOnly period, string payloadHash)
    {
        if (id == Guid.Empty)
            throw new DomainException("A payroll run needs HR's id for it.");
        Id = id;
        Period = Month(period);
        PayloadHash = payloadHash;
        Status = PayrollRunStatus.Payable;
        ReceivedAtUtc = UpdatedAtUtc = DateTime.UtcNow;
        Revision = 1;
    }

    // The month it pays, by its first day.
    public DateOnly Period { get; private set; }
    public int Employees { get; private set; }
    public decimal TotalGrossWages { get; private set; }
    public decimal TotalAdditions { get; private set; }
    public decimal TotalPenalties { get; private set; }
    public decimal TotalAdvancesDeducted { get; private set; }
    // Last month's shortfall, settled from this month's pay: owed by the staff, not a cost.
    public decimal TotalBroughtForward { get; private set; }
    public decimal NetCashPayable { get; private set; }
    public decimal LaborCost { get; private set; }
    public string PayloadHash { get; private set; } = string.Empty;
    public int Revision { get; private set; }
    public PayrollRunStatus Status { get; private set; }
    public DateTime ReceivedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }
    public Guid? SafeTransactionId { get; private set; }
    public DateTime? DisbursedAtUtc { get; private set; }
    public string? DisbursedBy { get; private set; }

    public IReadOnlyList<PayrollRunDepartment> Departments => _departments.OrderBy(d => d.Name).ToList().AsReadOnly();

    public bool IsDisbursed => Status == PayrollRunStatus.Disbursed;

    public string PeriodName => Period.ToString("MMMM yyyy", CultureInfo.InvariantCulture);

    // Its figures as HR sent them; the labor cost is the base wages and what was added, less the
    // penalties: what the month's work cost the business.
    public void Set(
        int employees, decimal grossWages, decimal additions, decimal penalties, decimal advancesDeducted, decimal broughtForward, decimal netCashPayable,
        IReadOnlyList<PayrollRunDepartment> departments, string payloadHash)
    {
        if (IsDisbursed)
            throw new DomainException($"The payroll of {PeriodName} is paid out of the safe already: void that payment first to change it. · المسير مصروف بالفعل.");
        if (new[] { grossWages, additions, penalties, advancesDeducted, broughtForward, netCashPayable }.Any(n => n < 0) || employees < 0)
            throw new DomainException("A payroll's figures are zero or more.");
        Employees = employees;
        TotalGrossWages = Money(grossWages);
        TotalAdditions = Money(additions);
        TotalPenalties = Money(penalties);
        TotalAdvancesDeducted = Money(advancesDeducted);
        TotalBroughtForward = Money(broughtForward);
        NetCashPayable = Money(netCashPayable);
        LaborCost = Money(grossWages + additions - penalties);
        _departments.Clear();
        _departments.AddRange(departments);
        // Sent changed: a new revision of it.
        if (PayloadHash != payloadHash)
            Revision++;
        PayloadHash = payloadHash;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    // Paid out of the safe by the entry given.
    public void Disbursed(Guid safeTransactionId, string by)
    {
        if (IsDisbursed && SafeTransactionId != safeTransactionId)
            throw new DomainException($"The payroll of {PeriodName} is paid already. · المسير مصروف بالفعل.");
        Status = PayrollRunStatus.Disbursed;
        SafeTransactionId = safeTransactionId;
        DisbursedAtUtc ??= DateTime.UtcNow;
        DisbursedBy ??= by;
    }

    // Its payment voided: owed again.
    public void Undisbursed()
    {
        Status = PayrollRunStatus.Payable;
        SafeTransactionId = null;
        DisbursedAtUtc = null;
        DisbursedBy = null;
    }

    public static DateOnly Month(DateOnly day) => new(day.Year, day.Month, 1);

    private static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
}

// A department's share of a payroll run, as HR named the department.
public sealed class PayrollRunDepartment : Entity
{
    private PayrollRunDepartment() { }

    public PayrollRunDepartment(string name, int employees, decimal grossWages, decimal additions, decimal penalties, decimal advancesDeducted,
        decimal netCashPayable)
    {
        Id = Guid.NewGuid();
        Name = string.IsNullOrWhiteSpace(name) ? "General" : name.Trim() is { Length: > 100 } n ? n[..100] : name.Trim();
        Employees = employees;
        GrossWages = Math.Round(grossWages, 2, MidpointRounding.AwayFromZero);
        Additions = Math.Round(additions, 2, MidpointRounding.AwayFromZero);
        Penalties = Math.Round(penalties, 2, MidpointRounding.AwayFromZero);
        AdvancesDeducted = Math.Round(advancesDeducted, 2, MidpointRounding.AwayFromZero);
        NetCashPayable = Math.Round(netCashPayable, 2, MidpointRounding.AwayFromZero);
    }

    public Guid PayrollRunId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public int Employees { get; private set; }
    public decimal GrossWages { get; private set; }
    public decimal Additions { get; private set; }
    public decimal Penalties { get; private set; }
    public decimal AdvancesDeducted { get; private set; }
    public decimal NetCashPayable { get; private set; }
    public decimal LaborCost => GrossWages + Additions - Penalties;
}

public enum StaffDeductionKind
{
    // The till short at the close (عجز خزنة), charged to who kept it.
    TillShortage = 1,

    // Something charged to an employee: a breakage, a meal, a loss (خصم على الموظف).
    StaffCharge = 2,
}

// An amount charged to an employee, to come off their pay: a till shortage or a staff charge. Kept
// here as a record (this system pays what HR says), and sent to HR, when linked, as a deduction
// from their pay. Voided, it is taken off there too.
public sealed class StaffDeduction : AggregateRoot
{
    public const int MaxReasonLength = 300;

    private StaffDeduction() { }

    public StaffDeduction(Guid id, Guid employeeId, DateOnly date, StaffDeductionKind kind, decimal amount, string? reason, string recordedBy)
    {
        if (employeeId == Guid.Empty)
            throw new DomainException("Choose the employee. · اختر الموظف.");
        if (!Enum.IsDefined(kind))
            throw new DomainException("Say whether it is a till shortage or a staff charge. · عجز خزنة أم خصم.");
        if (amount <= 0)
            throw new DomainException("Enter the amount, more than nothing. · أدخل المبلغ.");
        var why = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (why?.Length > MaxReasonLength)
            throw new DomainException($"Keep the reason under {MaxReasonLength} characters.");
        Id = id;
        EmployeeId = employeeId;
        Date = date;
        Kind = kind;
        Amount = Math.Round(amount, 2, MidpointRounding.AwayFromZero);
        Reason = why;
        RecordedBy = recordedBy;
        RecordedAtUtc = DateTime.UtcNow;
    }

    public Guid EmployeeId { get; private set; }
    public DateOnly Date { get; private set; }
    public StaffDeductionKind Kind { get; private set; }
    public decimal Amount { get; private set; }
    public string? Reason { get; private set; }
    public string RecordedBy { get; private set; } = string.Empty;
    public DateTime RecordedAtUtc { get; private set; }
    public DateTime? VoidedAtUtc { get; private set; }
    public string? VoidedBy { get; private set; }
    public bool IsVoided => VoidedAtUtc is not null;

    public void Void(string by)
    {
        if (IsVoided)
            throw new DomainException("This deduction is voided already.");
        VoidedAtUtc = DateTime.UtcNow;
        VoidedBy = by;
    }
}

public interface IPayrollRunRepository : IRepository<PayrollRun>
{
    // The latest first.
    Task<IReadOnlyList<PayrollRun>> GetRecentAsync(int take, CancellationToken cancellationToken = default);

    // The run of a month, if one was sent.
    Task<PayrollRun?> GetForPeriodAsync(DateOnly period, CancellationToken cancellationToken = default);

    void Remove(PayrollRun run);
}

public interface IStaffDeductionRepository : IRepository<StaffDeduction>
{
    Task<IReadOnlyList<StaffDeduction>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default);
}
