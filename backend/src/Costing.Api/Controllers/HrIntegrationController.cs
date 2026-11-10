using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Costing.Api.Auth;
using Costing.Application.Approvals;
using Costing.Application.Company;
using Costing.Application.Integrations;
using Costing.Application.Staff;
using Costing.Application.Treasury;
using Costing.Domain.Access;
using Costing.Domain.Integrations;
using Costing.Domain.Staff;
using Costing.Infrastructure.Integrations;

namespace Costing.Api.Controllers;

// What the HR system calls here, with this system's key for it in X-API-Key, only while the link is
// switched on:
//   GET  ping         the link test, from HR's Settings → Costing Integration
//   POST payroll-run  a month's payroll approved on HR: its labor cost and net cash payable
// No user signs in for these. A wrong key, or none, or the link off, is refused and logged.
[ApiController]
[Route("api/integrations/hr")]
[AllowAnonymous]
[TypeFilter(typeof(HrKeyFilter))]
public sealed class HrIntegrationController(ISender sender, IHrSyncJournal journal) : ControllerBase
{
    [HttpGet("ping")]
    public async Task<IActionResult> Ping(CancellationToken cancellationToken)
    {
        var name = (await sender.Send(new GetCompanySettingsQuery(), cancellationToken)).Name;
        await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Inbound, "ping", HrSyncOutcome.Read, "Link tested from HR."), cancellationToken);
        return Ok(new { ok = true, system = "Costing", company = name, atUtc = DateTime.UtcNow });
    }

    // Recorded (200, Recorded or Updated), the same again (200, Unchanged); refused (422) with why.
    [HttpPost("payroll-run")]
    public Task<PayrollRunResultDto> PayrollRun(PayrollRunInput request, CancellationToken cancellationToken) =>
        sender.Send(new ReceivePayrollRunCommand(request), cancellationToken);
}

// This system's key for HR in X-API-Key (or X-Costing-Key), checked against the hash kept; a wrong
// one, or none, or the link switched off, is answered 401 and logged. Never logs the key.
public sealed class HrKeyFilter(ISender sender, IHrSyncJournal journal) : IAsyncActionFilter
{
    public static readonly string[] Headers = ["X-API-Key", "X-Costing-Key"];

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        var key = Headers.Select(h => request.Headers[h].ToString()).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
        if (!await sender.Send(new VerifyHrKeyQuery(key), context.HttpContext.RequestAborted))
        {
            var call = request.Path.Value?.Split('/').LastOrDefault() ?? "hr";
            await journal.WriteAsync(new HrSyncLog(HrSyncDirection.Inbound, call, HrSyncOutcome.Unauthorized,
                key is null ? "Refused: no X-API-Key." : "Refused: the key is not this system's key for HR, or the HR link is switched off.",
                detail: $"From {context.HttpContext.Connection.RemoteIpAddress}"), context.HttpContext.RequestAborted);
            context.Result = new UnauthorizedObjectResult(new { errors = new[] { "Send this system's key for HR in X-API-Key, with the HR link switched on." } });
            return;
        }
        await next();
    }
}

// Settings → HR Integration (ربط الموارد البشرية), a manager's: the link switched on or off, HR's
// address and key, this system's key for HR (shown once), the link tested, HR's employees read, and
// the sync log and what waits to be sent.
[ApiController]
[Route("api/settings/hr-integration")]
[Authorize(Policy = Permissions.SettingsManage)]
public sealed class HrIntegrationSettingsController(ISender sender, IHrOutboxSender outbox) : ControllerBase
{
    [HttpGet]
    public Task<HrIntegrationDto> Get(CancellationToken cancellationToken) => sender.Send(new GetHrIntegrationQuery(), cancellationToken);

    // HrKey: HR's key, when a new one is pasted; left out, the one kept stays.
    [HttpPut]
    public Task<HrIntegrationDto> Save(HrLinkRequest request, CancellationToken cancellationToken) =>
        sender.Send(new SaveHrLinkCommand(request.Enabled, request.BaseUrl, request.HrKey, StaffName), cancellationToken);

    // A new key for HR, in full this once; the one before stops working.
    [HttpPost("key")]
    public Task<HrKeyDto> GenerateKey(CancellationToken cancellationToken) => sender.Send(new GenerateHrKeyCommand(StaffName), cancellationToken);

    [HttpPost("test")]
    public Task<HrTestResultDto> Test(CancellationToken cancellationToken) => sender.Send(new TestHrLinkCommand(), cancellationToken);

    [HttpPost("sync-employees")]
    public Task<HrEmployeeSyncDto> SyncEmployees(CancellationToken cancellationToken) => sender.Send(new SyncHrEmployeesCommand(), cancellationToken);

    // What waits sent now, rather than on the link's next tick.
    [HttpPost("outbox/send")]
    public async Task<object> SendNow(CancellationToken cancellationToken) => new { sent = await outbox.SendDueAsync(cancellationToken) };

    [HttpPost("outbox/{itemId:guid}/retry")]
    public Task<HrOutboxItemDto> Retry(Guid itemId, CancellationToken cancellationToken) => sender.Send(new RetryHrOutboxCommand(itemId), cancellationToken);

    private string StaffName => User.FindFirst(UserClaims.Name)?.Value ?? string.Empty;
}

public sealed record HrLinkRequest(bool Enabled, string? BaseUrl, string? HrKey);

// The payrolls HR approved and sent (Financials → Staff → Payroll from HR), and each paid out of the
// safe: a manager's at once (200, the entry); anyone else's asked of a manager (202, the request).
[ApiController]
[Route("api/financials/payroll-runs")]
[Authorize(Policy = Permissions.InventoryManage)]
public sealed class PayrollRunsController(ISender sender) : ControllerBase
{
    [HttpGet]
    [CostingTab(CostingTabs.Financials)]
    public Task<IReadOnlyList<PayrollRunDto>> Get(CancellationToken cancellationToken) => sender.Send(new GetPayrollRunsQuery(), cancellationToken);

    [HttpPost("{runId:guid}/disburse")]
    [CostingTab(CostingTabs.Financials)]
    public async Task<IActionResult> Disburse(Guid runId, PayrollDisburseRequest request, CancellationToken cancellationToken)
    {
        var result = await sender.Send(new DisbursePayrollRunCommand(
            runId, request.TransactionId, request.RequestId, UserClaims.IdOf(User) ?? string.Empty, User.FindFirst(UserClaims.Name)?.Value ?? string.Empty,
            UserClaims.RoleOf(User) is { } role && RolePermissions.Has(role, Permissions.ApprovalDecide)), cancellationToken);
        return result.Outcome == ApprovalOutcome.Applied ? Ok(result) : Accepted(result);
    }
}

public sealed record PayrollDisburseRequest(Guid TransactionId, Guid RequestId);

// The staff and the HR link as the screens that choose an employee see it, the deductions charged
// to the staff, and a staff member added from the end of the day while HR is not linked.
[ApiController]
[Route("api/staff")]
[Authorize(Policy = Permissions.InventoryView)]
public sealed class StaffHrController(ISender sender) : ControllerBase
{
    private const CostingTabs Choosers = CostingTabs.Financials | CostingTabs.Purchases | CostingTabs.Waste | CostingTabs.EndOfDay;

    // Whether the staff come from HR now.
    [HttpGet("hr-status")]
    [CostingTab(Choosers)]
    public Task<HrStatusDto> HrStatus(CancellationToken cancellationToken) => sender.Send(new GetHrStatusQuery(), cancellationToken);

    [HttpPost("local")]
    [CostingTab(CostingTabs.Financials | CostingTabs.EndOfDay)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StaffMemberDto> AddLocal(LocalStaffRequest request, CancellationToken cancellationToken) =>
        sender.Send(new AddLocalStaffMemberCommand(request.Id, request.Name, request.JobTitle), cancellationToken);

    [HttpGet("deductions")]
    [CostingTab(CostingTabs.Financials)]
    public Task<IReadOnlyList<StaffDeductionDto>> Deductions([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken cancellationToken) =>
        sender.Send(new GetStaffDeductionsQuery(from, to), cancellationToken);

    // A till shortage or a staff charge, to come off their pay: sent to HR when it is linked.
    [HttpPost("deductions")]
    [CostingTab(CostingTabs.Financials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StaffDeductionDto> RecordDeduction(StaffDeductionRequest request, CancellationToken cancellationToken) =>
        sender.Send(new RecordStaffDeductionCommand(
            request.Id, request.EmployeeId, request.Date, request.Kind, request.Amount, request.Reason, User.FindFirst(UserClaims.Name)?.Value ?? string.Empty),
            cancellationToken);

    [HttpPost("deductions/{deductionId:guid}/void")]
    [CostingTab(CostingTabs.Financials)]
    [Authorize(Policy = Permissions.InventoryManage)]
    public Task<StaffDeductionDto> VoidDeduction(Guid deductionId, CancellationToken cancellationToken) =>
        sender.Send(new VoidStaffDeductionCommand(deductionId, User.FindFirst(UserClaims.Name)?.Value ?? string.Empty), cancellationToken);
}

public sealed record LocalStaffRequest(Guid Id, string Name, string? JobTitle);

public sealed record StaffDeductionRequest(Guid Id, Guid EmployeeId, DateOnly Date, StaffDeductionKind Kind, decimal Amount, string? Reason);
