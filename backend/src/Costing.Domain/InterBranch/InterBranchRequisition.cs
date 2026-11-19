using System.Globalization;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.RawMaterials;

namespace Costing.Domain.InterBranch;

public enum RequisitionStatus
{
    // Sent to the central kitchen (مرسل للمركزي): nothing dispatched yet.
    Submitted = 1,

    // Part of it dispatched (صرف جزئي): the rest still to come.
    PartiallyDispatched = 2,

    // All of it dispatched and on its way (تم الصرف وفي الطريق).
    Dispatched = 3,

    // All of it dispatched and received by the branch (تم الاستلام بالفرع).
    Received = 4,

    // Called off before anything was dispatched (ملغي).
    Cancelled = 5,
}

// A branch's requisition (أمر طلب بضاعة من الفرع): what a restaurant asks its central kitchen or
// warehouse to send, by when. Quantities only, never prices: the kitchen prices what it sends.
// Numbered REQ-2026-0001 by the year it is made in. What has been dispatched and received of each
// line, and its status, follow its shipments (Restate); called off only while nothing is dispatched.
public sealed class InterBranchRequisition : AggregateRoot, IBranchOwned
{
    public const int MaxNotes = 500;
    public const int MaxLineNotes = 200;
    public const int MaxLines = 200;

    private readonly List<InterBranchRequisitionLine> _lines = [];

    private InterBranchRequisition() { }

    // The branch asking: the requisition is its record.
    public Guid BranchId { get; private set; }

    public void AssignBranch(Guid branchId) => BranchId = branchId;

    public Guid RequestingBranchId => BranchId;
    public string Number { get; private set; } = string.Empty;
    public Guid SupplyingBranchId { get; private set; }
    public DateOnly RequestDate { get; private set; }
    public DateOnly? RequestedDeliveryDate { get; private set; }
    public RequisitionStatus Status { get; private set; } = RequisitionStatus.Submitted;
    public string? Notes { get; private set; }
    public string CreatedBy { get; private set; } = string.Empty;
    public string? CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? CancelledAtUtc { get; private set; }
    public string? CancelledBy { get; private set; }
    public IReadOnlyList<InterBranchRequisitionLine> Lines => _lines;

    // Still to be dispatched, or on its way: what the hub counts as open.
    public bool IsOpen => Status is RequisitionStatus.Submitted or RequisitionStatus.PartiallyDispatched or RequisitionStatus.Dispatched;

    public static string NumberFor(int year, int sequence) => string.Create(CultureInfo.InvariantCulture, $"REQ-{year}-{sequence:0000}");

    // Asked of a central kitchen or warehouse, another branch in use, for one or more materials.
    public static InterBranchRequisition Submit(
        Guid id, string number, Branch requesting, Branch supplying, DateOnly date, DateOnly? deliveryBy,
        IReadOnlyList<(RawMaterial Material, decimal Quantity, string? Notes)> lines, string? notes, string by, string? byUserId)
    {
        if (requesting.Id == supplying.Id)
            throw new DomainException($"{requesting.Name} cannot ask itself: choose the central kitchen or warehouse that supplies it. · اختر المطبخ المركزي.");
        if (!supplying.Supplies())
            throw new DomainException(
                $"{supplying.Name} is a restaurant: a requisition goes to a central kitchen or warehouse. · الطلب يُرسل لمطبخ أو مخزن مركزي.");
        if (!requesting.IsActive || !supplying.IsActive)
            throw new DomainException($"{(!requesting.IsActive ? requesting.Name : supplying.Name)} is not in use. · الفرع غير مفعّل.");
        if (deliveryBy is { } wanted && wanted < date)
            throw new DomainException("Ask for it on a day still to come: the delivery date is before today. · تاريخ التوريد قبل اليوم.");
        if (lines.Count == 0)
            throw new DomainException("Ask for at least one material. · أضف خامة واحدة على الأقل.");
        if (lines.Count > MaxLines)
            throw new DomainException($"A requisition asks for {MaxLines} materials at most.");
        if (lines.GroupBy(l => l.Material.Id).FirstOrDefault(g => g.Count() > 1) is { } twice)
            throw new DomainException($"{twice.First().Material.Name} is on the requisition twice: put it on one line.");
        var said = Said(notes, MaxNotes, "the notes");
        var requisition = new InterBranchRequisition
        {
            Id = id, Number = number, BranchId = requesting.Id, SupplyingBranchId = supplying.Id, RequestDate = date, RequestedDeliveryDate = deliveryBy,
            Notes = said, CreatedBy = by, CreatedByUserId = byUserId, CreatedAtUtc = DateTime.UtcNow,
        };
        foreach (var (material, quantity, lineNotes) in lines)
        {
            if (quantity <= 0)
                throw new DomainException($"{material.Name}: ask for more than nothing. · الكمية أكبر من صفر.");
            requisition._lines.Add(new InterBranchRequisitionLine(id, material.Id, quantity, material.Unit.ToString(),
                Said(lineNotes, MaxLineNotes, $"the note on {material.Name}")));
        }
        return requisition;
    }

    // Called off: only before anything of it has been dispatched.
    public void Cancel(string by)
    {
        if (Status == RequisitionStatus.Cancelled)
            throw new DomainException("This requisition has already been cancelled. · تم إلغاء هذا الطلب بالفعل.");
        if (Status != RequisitionStatus.Submitted || _lines.Any(l => l.DispatchedQuantity > 0))
            throw new DomainException(
                $"{Number} has been dispatched already: it can no longer be cancelled. Void its dispatch first. · تم الصرف بالفعل؛ ألغِ الصرف أولاً.");
        Status = RequisitionStatus.Cancelled;
        CancelledAtUtc = DateTime.UtcNow;
        CancelledBy = by;
    }

    // What is still to send of a material: what was asked less what has been dispatched.
    public decimal Outstanding(Guid rawMaterialId) =>
        _lines.Where(l => l.RawMaterialId == rawMaterialId).Sum(l => Math.Max(l.RequestedQuantity - l.DispatchedQuantity, 0));

    // Its lines and status as its shipments now stand (voided ones left out): what each sent and
    // what each brought in. None: submitted again. Some on their way: dispatched, or partly if a
    // line is still short. All received: received, or partly dispatched if a line is still short.
    public void Restate(IEnumerable<InternalSalesInvoice> shipments)
    {
        if (Status == RequisitionStatus.Cancelled)
            return;
        var live = shipments.Where(s => s.RequisitionId == Id && s.Status != ShipmentStatus.Voided).ToList();
        foreach (var line in _lines)
        {
            var sent = live.SelectMany(s => s.Lines).Where(l => l.RawMaterialId == line.RawMaterialId).ToList();
            line.Track(sent.Sum(l => l.Quantity), sent.Sum(l => l.ReceivedQuantity ?? 0));
        }
        if (live.Count == 0)
        {
            Status = RequisitionStatus.Submitted;
            return;
        }
        var all = _lines.All(l => l.DispatchedQuantity >= l.RequestedQuantity);
        var moving = live.Any(s => s.Status == ShipmentStatus.InTransit);
        Status = (moving, all) switch
        {
            (true, true) => RequisitionStatus.Dispatched,
            (false, true) => RequisitionStatus.Received,
            _ => RequisitionStatus.PartiallyDispatched,
        };
    }

    internal static string? Said(string? text, int max, string what)
    {
        var said = string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        if (said?.Length > max)
            throw new DomainException($"Keep {what} to {max} characters.");
        return said;
    }
}

// A material asked for, in its own unit (grams, millilitres, pieces): what was asked, and what of
// it has been dispatched and received so far.
public sealed class InterBranchRequisitionLine
{
    private InterBranchRequisitionLine() { }

    internal InterBranchRequisitionLine(Guid requisitionId, Guid rawMaterialId, decimal requestedQuantity, string unit, string? notes)
    {
        Id = Guid.NewGuid();
        InterBranchRequisitionId = requisitionId;
        RawMaterialId = rawMaterialId;
        RequestedQuantity = requestedQuantity;
        Unit = unit;
        Notes = notes;
    }

    public Guid Id { get; private set; }
    public Guid InterBranchRequisitionId { get; private set; }
    public Guid RawMaterialId { get; private set; }
    public decimal RequestedQuantity { get; private set; }
    public decimal DispatchedQuantity { get; private set; }
    public decimal ReceivedQuantity { get; private set; }
    public string Unit { get; private set; } = string.Empty;
    public string? Notes { get; private set; }

    internal void Track(decimal dispatched, decimal received)
    {
        DispatchedQuantity = dispatched;
        ReceivedQuantity = received;
    }
}

public static class SupplyingBranches
{
    // A central kitchen or warehouse: a branch that supplies the others.
    public static bool Supplies(this Branch branch) => branch.Type is BranchType.CentralKitchen or BranchType.CentralWarehouse;
}

public interface IInterBranchRequisitionRepository : IRepository<InterBranchRequisition>
{
    // The branch's, asked by it or of it: made in the period, or still open whenever made.
    Task<IReadOnlyList<InterBranchRequisition>> GetForBranchAsync(Guid branchId, DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<InterBranchRequisition>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default);

    Task<int> CountInYearAsync(int year, CancellationToken cancellationToken = default);
}
