using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Costing.Api.Auth;
using Costing.Application.Books;
using Costing.Domain.Access;

namespace Costing.Api.Controllers;

// Period lock & month-end close (إقفال الفترة المحاسبية وتجميد الدفاتر), on Settings: the books
// closed until a day, by a manager (settings.manage) who types LOCK; rolled back or lifted by the
// owner (settings.unlock-periods) with a reason. Each change in the security audit log, listed here.
[ApiController]
[Route("api/settings/period-lock")]
[Authorize(Policy = Permissions.SettingsManage)]
public sealed class PeriodLockController(ISender sender) : ControllerBase
{
    [HttpGet]
    public Task<PeriodLockDto> Get([FromQuery] int history = 20, CancellationToken cancellationToken = default) =>
        sender.Send(new GetPeriodLockQuery(history), cancellationToken);

    [HttpPost("lock")]
    public Task<PeriodLockDto> Lock(LockBooksRequest request, CancellationToken cancellationToken) =>
        sender.Send(new LockBooksCommand(request.Until, request.Confirmation, UserClaims.IdOf(User) ?? string.Empty, UserClaims.NameOf(User)),
            cancellationToken);

    [HttpPost("unlock")]
    [Authorize(Policy = Permissions.SettingsUnlockPeriods)]
    public Task<PeriodLockDto> Unlock(UnlockBooksRequest request, CancellationToken cancellationToken) =>
        sender.Send(new UnlockBooksCommand(request.Until, request.Reason, UserClaims.IdOf(User) ?? string.Empty, UserClaims.NameOf(User)),
            cancellationToken);
}

public sealed record LockBooksRequest(DateOnly Until, string? Confirmation);

// Until: the day the books stay closed until; none: the lock lifted.
public sealed record UnlockBooksRequest(DateOnly? Until, string? Reason);
