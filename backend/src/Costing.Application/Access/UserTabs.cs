using MediatR;
using Costing.Domain.Access;
using Costing.Domain.Common;

namespace Costing.Application.Access;

// Permissions (الصلاحيات): the sections of Costing & Financials each user works. A manager holds
// them all and alone gives them; everyone else works their role's (CostingTabSet.DefaultFor) until a
// manager ticks theirs, then only those.

// A system user, as the API reads them from the users.
public sealed record UserAccountRef(string Id, string Name, UserRole Role);

// Restricted once a manager has ticked their tabs; their role's until then.
public sealed record UserTabsDto(string Id, string Name, UserRole Role, bool Restricted, IReadOnlyList<CostingTabs> Tabs, string? SetBy, DateTime? SetAtUtc);

// Every user who is not a manager, by name.
public sealed record GetUserTabsQuery(IReadOnlyList<UserAccountRef> Users) : IRequest<IReadOnlyList<UserTabsDto>>;

internal sealed class GetUserTabsHandler(IUserTabAccessRepository access) : IRequestHandler<GetUserTabsQuery, IReadOnlyList<UserTabsDto>>
{
    public async Task<IReadOnlyList<UserTabsDto>> Handle(GetUserTabsQuery request, CancellationToken cancellationToken)
    {
        var rows = (await access.GetAllAsync(cancellationToken)).ToDictionary(a => a.UserId);
        return request.Users
            .Where(u => u.Role != UserRole.Manager)
            .OrderBy(u => u.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(u => UserTabsDtos.Of(u, rows.GetValueOrDefault(u.Id)))
            .ToList();
    }
}

// A user's tabs: only those from now on. Null puts them back to their role's.
public sealed record SetUserTabsCommand(UserAccountRef User, CostingTabs? Tabs, string SetBy) : IRequest<UserTabsDto>;

internal sealed class SetUserTabsHandler(IUserTabAccessRepository access, IUnitOfWork unitOfWork) : IRequestHandler<SetUserTabsCommand, UserTabsDto>
{
    public async Task<UserTabsDto> Handle(SetUserTabsCommand request, CancellationToken cancellationToken)
    {
        if (request.User.Role == UserRole.Manager)
            throw new DomainException("A manager works every section, always.");
        var row = await access.GetByUserAsync(request.User.Id, cancellationToken);
        if (request.Tabs is not { } tabs)
        {
            if (row is not null)
                access.Remove(row);
            row = null;
        }
        else if (row is null)
        {
            row = new UserTabAccess(request.User.Id, tabs, request.SetBy);
            access.Add(row);
        }
        else
        {
            row.Set(tabs, request.SetBy);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);
        return UserTabsDtos.Of(request.User, row);
    }
}

internal static class UserTabsDtos
{
    public static UserTabsDto Of(UserAccountRef user, UserTabAccess? row) =>
        new(user.Id, user.Name, user.Role, row is not null, CostingTabSet.Split(row?.Tabs ?? CostingTabSet.DefaultFor(user.Role)), row?.SetBy, row?.SetAtUtc);
}
