using Costing.Domain.Common;

namespace Costing.Domain.Integrations;

// The restaurant's point of sale, linked (ربط نقطة البيع): it reads the menu from here and sends
// each shift's Z report, which becomes the day's sales summary (its stock taken by the recipes)
// and the day's takings in the safe. It proves itself by a key a manager makes here and pastes
// into the POS; only the key's hash is kept, never the key.
public sealed class PosLink : AggregateRoot
{
    public static readonly Guid SingletonId = new("7d3c1b2a-5e4f-4a6b-9c8d-0f1e2d3c4b5a");
    public const int HashLength = 64;
    public const int HintLength = 12;

    private PosLink() { }

    public static PosLink Create() => new() { Id = SingletonId };

    // SHA-256 of the key, hex; and its last characters, to tell which key the POS has.
    public string? KeyHash { get; private set; }
    public string? KeyHint { get; private set; }
    public DateTime? KeyCreatedAtUtc { get; private set; }
    public string? KeyCreatedBy { get; private set; }

    public bool HasKey => KeyHash is not null;

    // A new key: the one before stops working at once.
    public void SetKey(string hash, string hint, string by)
    {
        if (hash.Length != HashLength)
            throw new DomainException("A key's hash is 64 hex characters.");
        KeyHash = hash;
        KeyHint = hint.Length > HintLength ? hint[^HintLength..] : hint;
        KeyCreatedAtUtc = DateTime.UtcNow;
        KeyCreatedBy = by;
    }
}

// One shift's Z report as the POS sent it, by the POS's own id for it: sent again (the answer was
// lost), it is the same report; sent changed (the shift was corrected), it replaces what it was.
public sealed class PosZReport : AggregateRoot
{
    private PosZReport() { }

    public PosZReport(Guid id, DateOnly businessDate, int? shiftNumber, string source, string payloadHash, string payload)
    {
        if (id == Guid.Empty)
            throw new DomainException("A Z report needs its id from the POS.");
        Id = id;
        ReceivedAtUtc = DateTime.UtcNow;
        Set(businessDate, shiftNumber, source, payloadHash, payload);
        Revision = 1;
    }

    public DateOnly BusinessDate { get; private set; }
    public int? ShiftNumber { get; private set; }

    // Which endpoint it came by: z-report or events (day.closed).
    public string Source { get; private set; } = string.Empty;

    // SHA-256 of the report as read, to know a resend from a change.
    public string PayloadHash { get; private set; } = string.Empty;
    public string Payload { get; private set; } = string.Empty;
    public DateTime ReceivedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }
    public int Revision { get; private set; }

    public void Replace(DateOnly businessDate, int? shiftNumber, string source, string payloadHash, string payload)
    {
        Set(businessDate, shiftNumber, source, payloadHash, payload);
        Revision += 1;
    }

    private void Set(DateOnly businessDate, int? shiftNumber, string source, string payloadHash, string payload)
    {
        BusinessDate = businessDate;
        ShiftNumber = shiftNumber;
        Source = source;
        PayloadHash = payloadHash;
        Payload = payload;
        UpdatedAtUtc = DateTime.UtcNow;
    }
}

// A business day as the POS made it: the sales summary and the takings recorded from that day's Z
// reports (every shift's, together), so a report sent again or changed replaces exactly these and
// nothing a person entered.
public sealed class PosDay : AggregateRoot
{
    private PosDay() { }

    public PosDay(Guid id, DateOnly date)
    {
        Id = id;
        Date = date;
    }

    public DateOnly Date { get; private set; }
    public Guid? SaleId { get; private set; }
    public Guid? TakingsId { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    public void Recorded(Guid? saleId, Guid? takingsId)
    {
        SaleId = saleId;
        TakingsId = takingsId;
        UpdatedAtUtc = DateTime.UtcNow;
    }
}

public enum PosSyncOutcome
{
    // A Z report's day recorded for the first time.
    Recorded = 1,

    // A changed Z report: the day's records replaced.
    Updated = 2,

    // The same Z report sent again: nothing changed.
    Unchanged = 3,

    // Not taken, and nothing recorded: why is in the message (an item not on the menu, a day
    // entered by hand, the amounts).
    Refused = 4,

    // A wrong key, or none.
    Unauthorized = 5,

    // Failed on this side; nothing recorded.
    Failed = 6,

    // Read and answered: the menu, the link test, an event Costing does not use.
    Served = 7,
}

// Every call from the POS, as it went: when, what, the outcome and why. Kept apart from what the
// call recorded, so a call refused or failed is still in the log.
public sealed class PosSyncLog
{
    public const int MaxMessage = 1000;
    public const int MaxDetail = 4000;

    private PosSyncLog() { }

    public PosSyncLog(string endpoint, PosSyncOutcome outcome, string message, Guid? zReportId = null, DateOnly? businessDate = null, string? detail = null)
    {
        Id = Guid.NewGuid();
        AtUtc = DateTime.UtcNow;
        Endpoint = endpoint.Length > 60 ? endpoint[..60] : endpoint;
        Outcome = outcome;
        Message = message.Length > MaxMessage ? message[..MaxMessage] : message;
        ZReportId = zReportId;
        BusinessDate = businessDate;
        Detail = detail is { Length: > MaxDetail } ? detail[..MaxDetail] : detail;
    }

    public Guid Id { get; private set; }
    public DateTime AtUtc { get; private set; }
    public string Endpoint { get; private set; } = string.Empty;
    public PosSyncOutcome Outcome { get; private set; }
    public string Message { get; private set; } = string.Empty;
    public Guid? ZReportId { get; private set; }
    public DateOnly? BusinessDate { get; private set; }
    public string? Detail { get; private set; }
}

public interface IPosLinkStore
{
    Task<PosLink> GetAsync(CancellationToken cancellationToken = default);
}

public interface IPosZReportRepository : IRepository<PosZReport>
{
    Task<IReadOnlyList<PosZReport>> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default);
}

public interface IPosDayRepository : IRepository<PosDay>
{
    Task<PosDay?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default);
}

// Written apart from the call's own work: a refused or failed call is logged all the same.
public interface IPosSyncJournal
{
    Task WriteAsync(PosSyncLog entry, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PosSyncLog>> RecentAsync(int count, CancellationToken cancellationToken = default);
}
