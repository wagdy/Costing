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
