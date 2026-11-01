using MediatR;
using Costing.Application.Common;
using Costing.Domain.Common;
using Costing.Domain.Staff;

namespace Costing.Application.Staff;

// Staff (الموظفين): who the safe pays advances and salaries to. Only their names and jobs: the people
// themselves are the HR system's.

public sealed record StaffMemberDto(Guid Id, string Name, string? JobTitle, bool IsActive)
{
    public static StaffMemberDto From(StaffMember s) => new(s.Id, s.Name, s.JobTitle, s.IsActive);
}

// Left ones too, by name.
public sealed record GetStaffQuery : IRequest<IReadOnlyList<StaffMemberDto>>;

internal sealed class GetStaffHandler(IStaffMemberRepository staff) : IRequestHandler<GetStaffQuery, IReadOnlyList<StaffMemberDto>>
{
    public async Task<IReadOnlyList<StaffMemberDto>> Handle(GetStaffQuery request, CancellationToken cancellationToken) =>
        (await staff.GetAllAsync(cancellationToken)).Select(StaffMemberDto.From).ToList();
}

// Added (an id not there yet, made by the app) or changed; IsActive false for one who has left.
public sealed record SaveStaffMemberCommand(Guid Id, string Name, string? JobTitle, bool IsActive) : IRequest<StaffMemberDto>, IRetryOnConflict;

internal sealed class SaveStaffMemberHandler(IStaffMemberRepository staff, IUnitOfWork unitOfWork) : IRequestHandler<SaveStaffMemberCommand, StaffMemberDto>
{
    public async Task<StaffMemberDto> Handle(SaveStaffMemberCommand request, CancellationToken cancellationToken)
    {
        var member = await staff.GetByIdAsync(request.Id, cancellationToken);
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
        return StaffMemberDto.From(member);
    }
}
