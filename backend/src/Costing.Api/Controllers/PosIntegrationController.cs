using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Costing.Api.Auth;
using Costing.Application.Company;
using Costing.Application.Integrations;
using Costing.Domain.Access;
using Costing.Domain.Common;
using Costing.Domain.Integrations;

namespace Costing.Api.Controllers;

// What the restaurant's POS calls (api/integrations/pos), proving itself with the key made on
// Settings → POS Integration, in X-API-Key (or X-Pos-Node-Key, as the POS also sends it):
//   GET  ping       the link test
//   GET  menu       the menu, for the POS to take as its own
//   POST z-report   a shift's Z report
//   POST events     the POS's own envelope; day.closed is a shift's Z report
// No user signs in for these. A wrong key, or none, is refused and logged.
[ApiController]
[Route("api/integrations/pos")]
[AllowAnonymous]
[TypeFilter(typeof(PosKeyFilter))]
public sealed class PosIntegrationController(ISender sender, IPosSyncJournal journal) : ControllerBase
{
    [HttpGet("ping")]
    public async Task<IActionResult> Ping(CancellationToken cancellationToken)
    {
        var company = await sender.Send(new GetCompanySettingsQuery(), cancellationToken);
        await journal.WriteAsync(new PosSyncLog("ping", PosSyncOutcome.Served, "Link tested from the POS."), cancellationToken);
        return Ok(new { ok = true, system = "Costing", company = company.Name, atUtc = DateTime.UtcNow });
    }

    [HttpGet("menu")]
    public async Task<PosMenuDto> Menu(CancellationToken cancellationToken)
    {
        var menu = await sender.Send(new GetPosMenuQuery(), cancellationToken);
        await journal.WriteAsync(new PosSyncLog("menu", PosSyncOutcome.Served,
            $"Menu read by the POS: {menu.Items.Count} items, {menu.Items.Sum(i => i.Sizes.Count)} sizes, {menu.Categories.Count} categories."), cancellationToken);
        return menu;
    }

    [HttpPost("z-report")]
    public Task<IActionResult> ZReport(ZReportRequest request, CancellationToken cancellationToken) =>
        ReceiveAsync(request.ToInput(), "z-report", cancellationToken);

    [HttpPost("events")]
    public async Task<IActionResult> Event(JsonElement envelope, CancellationToken cancellationToken)
    {
        var kind = envelope.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString() : null;
        if (kind != PosEvents.DayClosed || !envelope.TryGetProperty("data", out var data))
        {
            await journal.WriteAsync(new PosSyncLog("events", PosSyncOutcome.Served, $"Event {kind ?? "(no kind)"} received: Costing does not use it."), cancellationToken);
            return Accepted();
        }

        ZReportInput report;
        try
        {
            report = PosEvents.DayClosedReport(data);
        }
        catch (Exception ex) when (ex is DomainException or FormatException or InvalidOperationException)
        {
            await journal.WriteAsync(new PosSyncLog("events", PosSyncOutcome.Refused, "day.closed could not be read: " + ex.Message), cancellationToken);
            return UnprocessableEntity(new { errors = new[] { "day.closed could not be read: " + ex.Message } });
        }
        return await ReceiveAsync(report, "events", cancellationToken);
    }

    // Refused (a business rule): 422, and the POS keeps it as failed until it is sent again.
    // Collided with a change at the same time, for good: 503, so the POS tries again; a 409 would
    // tell it the report was had already.
    private async Task<IActionResult> ReceiveAsync(ZReportInput report, string source, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await sender.Send(new ReceiveZReportCommand(report, source), cancellationToken));
        }
        catch (ConflictException)
        {
            await journal.WriteAsync(new PosSyncLog(source, PosSyncOutcome.Failed, "Busy with another change: the POS will send it again.",
                report.ZReportId, report.Date), CancellationToken.None);
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { errors = new[] { "Busy: send it again in a moment." } });
        }
    }
}

// The key in X-API-Key, checked against the hash kept; a wrong one, or none, answered 401 and
// logged. Never logs the key.
public sealed class PosKeyFilter(ISender sender, IPosSyncJournal journal) : IAsyncActionFilter
{
    public static readonly string[] Headers = ["X-API-Key", "X-Pos-Node-Key"];

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        var key = Headers.Select(h => request.Headers[h].ToString()).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
        if (!await sender.Send(new VerifyPosKeyQuery(key), context.HttpContext.RequestAborted))
        {
            var endpoint = request.Path.Value?.Split('/').LastOrDefault() ?? "pos";
            await journal.WriteAsync(new PosSyncLog(endpoint, PosSyncOutcome.Unauthorized,
                key is null ? "Refused: no X-API-Key." : "Refused: the X-API-Key is not this system's key (make one on Settings → POS Integration).",
                detail: $"From {context.HttpContext.Connection.RemoteIpAddress}"), context.HttpContext.RequestAborted);
            context.Result = new UnauthorizedObjectResult(new { errors = new[] { "Send this system's POS key in X-API-Key." } });
            return;
        }
        await next();
    }
}

// The Z report as the POS sends it here (POST z-report). The cash and card are before tax, the tax
// collected on them, as the safe keeps a day's takings. Codes: 6101, a size 6101-17 (or the item's
// code and its size by name).
public sealed record ZReportRequest(
    Guid ZReportId, DateOnly Date, int? ShiftNumber, ZReportTakingsRequest? Takings, IReadOnlyList<ZReportSoldItem>? SoldItems,
    IReadOnlyList<ZReportWastedItem>? WastedItems)
{
    public ZReportInput ToInput() => new(
        ZReportId, Date, ShiftNumber,
        Takings is { } t ? new ZReportTakings(t.TotalCash, t.TotalCard, t.TotalTax, t.VoidsAmount, t.VoidReasons) : null!,
        (SoldItems ?? []).Select(i => new ZReportItem(Code(i.ItemCode), i.QuantitySold, i.Size, i.Name)).ToList(),
        (WastedItems ?? []).Select(i => new ZReportItem(Code(i.ItemCode), i.Quantity, i.Size, i.Name, i.Reason)).ToList());

    // A code written as a number or as text.
    private static string Code(JsonElement? code) => code switch
    {
        { ValueKind: JsonValueKind.String } text => text.GetString() ?? string.Empty,
        { ValueKind: JsonValueKind.Number } number => number.GetRawText(),
        _ => string.Empty,
    };
}

public sealed record ZReportTakingsRequest(decimal TotalCash, decimal TotalCard, decimal TotalTax, decimal VoidsAmount, IReadOnlyList<ZReportVoidReason>? VoidReasons);

public sealed record ZReportSoldItem(JsonElement? ItemCode, int QuantitySold, string? Size = null, string? Name = null);

public sealed record ZReportWastedItem(JsonElement? ItemCode, int Quantity, string? Size = null, string? Name = null, string? Reason = null);

// Settings → POS Integration, a manager's: the key (made, or made again) and the sync log.
[ApiController]
[Route("api/settings/pos-integration")]
[Authorize(Policy = Permissions.SettingsManage)]
public sealed class PosIntegrationSettingsController(ISender sender) : ControllerBase
{
    [HttpGet]
    public Task<PosIntegrationDto> Get([FromQuery] int logs = 200, CancellationToken cancellationToken = default) =>
        sender.Send(new GetPosIntegrationQuery(logs), cancellationToken);

    // A new key, shown this once: the one before stops working.
    [HttpPost("key")]
    public Task<PosKeyDto> NewKey(CancellationToken cancellationToken) =>
        sender.Send(new GeneratePosKeyCommand(User.FindFirst(UserClaims.Name)?.Value ?? string.Empty), cancellationToken);
}
