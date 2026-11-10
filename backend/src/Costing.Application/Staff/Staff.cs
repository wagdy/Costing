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
