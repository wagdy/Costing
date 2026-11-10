using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using MediatR;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Costing.Application.Common;
using Costing.Application.Integrations;
using Costing.Domain.Common;
using Costing.Domain.EndOfDay;
using Costing.Domain.Integrations;

namespace Costing.Infrastructure.Integrations;

// HR's key, encrypted at rest with AES-GCM under a key drawn (HKDF) from this server's own signing
// secret (Auth:SigningKey): readable here and nowhere else, and again after a redeploy. Changing
// the secret makes it unreadable, and HR's key is pasted again.
internal sealed class HrKeyProtector(IConfiguration configuration) : IHrKeyProtector
{
    private const string Version = "v1.";

    private byte[] Key
    {
        get
        {
            var secret = configuration["Auth:SigningKey"];
            if (string.IsNullOrEmpty(secret))
                throw new InvalidOperationException("Auth:SigningKey is needed to keep HR's key.");
            return HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(secret), 32, info: Encoding.UTF8.GetBytes("Costing.HrLink.Key"));
        }
    }

    public string Protect(string key)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plain = Encoding.UTF8.GetBytes(key);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(Key, 16);
        aes.Encrypt(nonce, plain, cipher, tag);
        return Version + Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public string? Unprotect(string protectedKey)
    {
        try
        {
            if (!protectedKey.StartsWith(Version, StringComparison.Ordinal))
                return null;
            var all = Convert.FromBase64String(protectedKey[Version.Length..]);
            var (nonce, tag, cipher) = (all[..12], all[12..28], all[28..]);
            var plain = new byte[cipher.Length];
            using var aes = new AesGcm(Key, 16);
            aes.Decrypt(nonce, cipher, tag, plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or ArgumentException)
        {
            return null;
        }
    }
}

// HR over HTTP: its key in X-API-Key, its answers read as HR gives them (camelCase).
internal sealed class HrGateway(IHttpClientFactory http) : IHrGateway
{
    public const string ClientName = "hr";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<HrPingResult> PingAsync(string baseUrl, string key, CancellationToken cancellationToken = default)
    {
        using var response = await SendAsync(HttpMethod.Get, baseUrl, "api/integrations/costing/ping", key, null, null, cancellationToken);
        await EnsureAsync(response, cancellationToken);
        var body = await response.Content.ReadFromJsonAsync<JsonObject>(Json, cancellationToken);
        return new HrPingResult(body?["system"]?.GetValue<string>(), body?["company"]?.GetValue<string>());
    }

    public async Task<IReadOnlyList<HrEmployeeRecord>> EmployeesAsync(string baseUrl, string key, CancellationToken cancellationToken = default)
    {
        using var response = await SendAsync(HttpMethod.Get, baseUrl, "api/integrations/hr/employees", key, null, null, cancellationToken);
        await EnsureAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<List<HrEmployeeRecord>>(Json, cancellationToken) ?? [];
    }

    public async Task<HrSendResult> SendAsync(string baseUrl, string key, string kind, string payload, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await SendAsync(HttpMethod.Post, baseUrl, $"api/integrations/costing/{kind}", key, payload, idempotencyKey, cancellationToken);
            var said = await ErrorsAsync(response, cancellationToken);
            return response.StatusCode switch
            {
                // Taken; or had already (kept once, by its key).
                _ when response.IsSuccessStatusCode => new HrSendResult(HrSendOutcome.Delivered, said ?? $"HR answered {(int)response.StatusCode}."),
                HttpStatusCode.Conflict => new HrSendResult(HrSendOutcome.Delivered, said ?? "HR had it already."),
                HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity or HttpStatusCode.NotFound or HttpStatusCode.Unauthorized
                    or HttpStatusCode.Forbidden => new HrSendResult(HrSendOutcome.Refused, said ?? $"HR refused it ({(int)response.StatusCode})."),
                _ => new HrSendResult(HrSendOutcome.Unavailable, said ?? $"HR answered {(int)response.StatusCode}."),
            };
        }
        catch (HrUnavailableException ex)
        {
            return new HrSendResult(HrSendOutcome.Unavailable, ex.Message);
        }
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string baseUrl, string path, string key, string? json, Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(method, new Uri(new Uri(baseUrl.TrimEnd('/') + "/"), path));
        request.Headers.Add("X-API-Key", key);
        if (idempotencyKey is { } idempotent)
            request.Headers.Add("Idempotency-Key", idempotent.ToString());
        if (json is not null)
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        try
        {
            return await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new HrUnavailableException($"HR could not be reached at {baseUrl}: {ex.Message}");
        }
    }

    private static async Task EnsureAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
            return;
        var said = await ErrorsAsync(response, cancellationToken);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new HrRefusedException("HR refused the key: make one on HR's Settings → Costing Integration and paste it here. · مفتاح الموارد البشرية غير صحيح.");
        if (response.StatusCode == HttpStatusCode.NotFound)
            throw new HrRefusedException("HR has no Costing link at that address: check it, and that HR is up to date.");
        throw new HrUnavailableException(said ?? $"HR answered {(int)response.StatusCode}.");
    }

    // The errors HR gave, as one line.
    private static async Task<string?> ErrorsAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
            return null;
        try
        {
            var body = await response.Content.ReadFromJsonAsync<JsonObject>(Json, cancellationToken);
            if (body?["errors"] is JsonArray errors && errors.Count > 0)
                return string.Join(" ", errors.Select(e => e?.ToString()));
            return body?["detail"]?.GetValue<string>() ?? body?["title"]?.GetValue<string>();
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException or InvalidOperationException)
        {
            return null;
        }
    }
}

// Sends what waits for HR, oldest first, while the link is on: each by its own endpoint with its
// idempotency key, an advance with its receipt (as base64, read from the end of the day's photos).
// Taken, it is sent; refused, it is kept as failed with HR's reason; out of reach, it is tried
// again later. Each try is logged.
public interface IHrOutboxSender
{
    // How many were sent now.
    Task<int> SendDueAsync(CancellationToken cancellationToken = default);
}

internal sealed class HrOutboxSender(
    IHrLinkStore links,
    IHrKeyProtector protector,
    IHrOutboxRepository outbox,
    IHrGateway gateway,
    IEndOfDayPhotoStore photos,
    IHrSyncJournal journal,
    IUnitOfWork unitOfWork) : IHrOutboxSender
{
    public async Task<int> SendDueAsync(CancellationToken cancellationToken = default)
    {
        var link = await links.GetAsync(cancellationToken);
        if (!link.IsReady || protector.Unprotect(link.HrKeyProtected!) is not { } key)
            return 0;
        var sent = 0;
        foreach (var item in await outbox.GetDueAsync(DateTime.UtcNow, 25, cancellationToken))
        {
            var result = await gateway.SendAsync(link.BaseUrl!, key, item.Kind, await PayloadAsync(item, cancellationToken), item.IdempotencyKey, cancellationToken);
            switch (result.Outcome)
            {
                case HrSendOutcome.Delivered:
                    item.Delivered();
                    sent++;
                    break;
                case HrSendOutcome.Refused:
                    item.Refused(result.Message);
                    break;
                default:
                    item.Postponed(result.Message);
                    break;
            }
            await unitOfWork.SaveChangesAsync(cancellationToken);
            await journal.WriteAsync(new HrSyncLog(
                HrSyncDirection.Outbound, item.Kind,
                result.Outcome switch { HrSendOutcome.Delivered => HrSyncOutcome.Sent, HrSendOutcome.Refused => HrSyncOutcome.Refused, _ => HrSyncOutcome.Failed },
                result.Outcome == HrSendOutcome.Delivered ? item.Summary : $"{item.Summary}: {result.Message}", item.IdempotencyKey), cancellationToken);
            // Out of reach: the rest wait too.
            if (result.Outcome == HrSendOutcome.Unavailable)
                break;
        }
        return sent;
    }

    // An advance's receipt, read now and sent with it as base64.
    private async Task<string> PayloadAsync(HrOutboxItem item, CancellationToken cancellationToken)
    {
        if (item.Kind != HrCalls.Advance || JsonNode.Parse(item.Payload) is not JsonObject payload
            || payload["receipt"] is not JsonObject receipt || receipt["photoId"]?.GetValue<Guid>() is not { } photoId)
            return item.Payload;
        if (await photos.GetAsync(photoId, cancellationToken) is { } content)
            receipt["contentBase64"] = Convert.ToBase64String(content);
        return payload.ToJsonString();
    }
}

// The link's own clock: every 10 seconds, what waits for HR is sent; every 6 hours (and soon after
// the link is switched on), HR's employees are read again. Nothing while it is switched off.
internal sealed class HrSyncWorker(IServiceScopeFactory scopes, ILogger<HrSyncWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan EmployeesEvery = TimeSpan.FromHours(6);

    // After HR's employees could not be read, not again for a while: the sync log says it once.
    private DateTime _employeesNotBefore = DateTime.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Every);
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var link = await scope.ServiceProvider.GetRequiredService<IHrLinkStore>().GetAsync(stoppingToken);
                if (!link.IsReady)
                    continue;
                await scope.ServiceProvider.GetRequiredService<IHrOutboxSender>().SendDueAsync(stoppingToken);
                if ((link.EmployeesSyncedAtUtc is not { } synced || DateTime.UtcNow - synced > EmployeesEvery) && DateTime.UtcNow >= _employeesNotBefore)
                {
                    _employeesNotBefore = DateTime.UtcNow.AddMinutes(5);
                    await using var syncing = scopes.CreateAsyncScope();
                    await syncing.ServiceProvider.GetRequiredService<ISender>().Send(new SyncHrEmployeesCommand(), stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // Logged and tried again on the next tick; the sync log says why to the user.
                logger.LogWarning(ex, "The HR link could not sync now.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
