namespace Costing.Domain.Common;

// A business rule refused the call. Messages are written to be shown to the user as they
// are; the API maps this type to a 4xx, never a 500. Open for the refusals that need a status
// of their own (PeriodLockedException: 423), so whatever catches a refusal catches those too.
public class DomainException(string message) : Exception(message);
