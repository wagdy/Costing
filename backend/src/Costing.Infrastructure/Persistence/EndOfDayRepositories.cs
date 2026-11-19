using Microsoft.EntityFrameworkCore;
using Costing.Domain.EndOfDay;

namespace Costing.Infrastructure.Persistence;

// A day by its date, the days in order and the last closed are the branch worked in's: each branch
// closes its own (one a business day in each). By id, an invoice's or a payment's, any branch's.
internal sealed class EndOfDayRepository(CostingDbContext db, Costing.Application.Company.ICurrentBranch branch) : IEndOfDayRepository
{
    private IQueryable<EndOfDayReport> WithInvoices => db.EndOfDayReports.Include(d => d.Invoices).Include(d => d.Payouts).AsSplitQuery();

    private async Task<IQueryable<EndOfDayReport>> HereAsync(CancellationToken cancellationToken)
    {
        var here = await branch.BranchIdAsync(cancellationToken);
        return WithInvoices.Where(d => d.BranchId == here);
    }

    public Task<EndOfDayReport?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        WithInvoices.SingleOrDefaultAsync(d => d.Id == id, cancellationToken);

    public void Add(EndOfDayReport aggregate) => db.EndOfDayReports.Add(aggregate);

    public async Task<EndOfDayReport?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default) =>
        await (await HereAsync(cancellationToken)).SingleOrDefaultAsync(d => d.Date == date, cancellationToken);

    public async Task<IReadOnlyList<EndOfDayReport>> GetDraftsAfterAsync(DateOnly date, CancellationToken cancellationToken = default) =>
        await (await HereAsync(cancellationToken)).Where(d => d.Status == EndOfDayStatus.Draft && d.Date > date).OrderBy(d => d.Date).ToListAsync(cancellationToken);

    public void Remove(EndOfDayReport report) => db.EndOfDayReports.Remove(report);

    public async Task<DateOnly?> LastSubmittedDateAsync(CancellationToken cancellationToken = default)
    {
        var here = await branch.BranchIdAsync(cancellationToken);
        return await db.EndOfDayReports.Where(d => d.Status == EndOfDayStatus.Submitted && d.BranchId == here).MaxAsync(d => (DateOnly?)d.Date, cancellationToken);
    }

    // Each branch in use that has closed a day: its last; the earliest of them.
    public async Task<DateOnly?> LastClosedEverywhereAsync(CancellationToken cancellationToken = default)
    {
        var inUse = db.Branches.Where(b => b.IsActive).Select(b => b.Id);
        var last = await db.EndOfDayReports
            .Where(d => d.Status == EndOfDayStatus.Submitted && inUse.Contains(d.BranchId))
            .GroupBy(d => d.BranchId)
            .Select(g => g.Max(d => d.Date))
            .ToListAsync(cancellationToken);
        return last.Count == 0 ? null : last.Min();
    }

    public async Task<IReadOnlyList<EndOfDayReport>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await (await HereAsync(cancellationToken)).Where(d => d.Date >= from && d.Date <= to).ToListAsync(cancellationToken);

    public Task<EndOfDayReport?> GetByInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default) =>
        WithInvoices.SingleOrDefaultAsync(d => d.Invoices.Any(i => i.Id == invoiceId), cancellationToken);

    public Task<EndOfDayReport?> GetByPayoutAsync(Guid payoutId, CancellationToken cancellationToken = default) =>
        WithInvoices.SingleOrDefaultAsync(d => d.Payouts.Any(p => p.Id == payoutId || p.VoucherId == payoutId), cancellationToken);
}

// A photo handed in at the end of the day: one row each, its bytes alone.
public sealed class EndOfDayPhotoContent
{
    public Guid Id { get; init; }
    public byte[] Content { get; set; } = [];
}

internal sealed class EndOfDayPhotoStore(CostingDbContext db) : IEndOfDayPhotoStore
{
    public void Put(Guid id, byte[] content)
    {
        var existing = db.EndOfDayPhotos.Local.FirstOrDefault(p => p.Id == id) ?? db.EndOfDayPhotos.Find(id);
        if (existing is null)
            db.EndOfDayPhotos.Add(new EndOfDayPhotoContent { Id = id, Content = content });
        else
            existing.Content = content;
    }

    public async Task<byte[]?> GetAsync(Guid id, CancellationToken cancellationToken = default) =>
        db.EndOfDayPhotos.Local.FirstOrDefault(p => p.Id == id)?.Content
        ?? await db.EndOfDayPhotos.AsNoTracking().Where(p => p.Id == id).Select(p => p.Content).SingleOrDefaultAsync(cancellationToken);

    public void Remove(Guid id)
    {
        if ((db.EndOfDayPhotos.Local.FirstOrDefault(p => p.Id == id) ?? db.EndOfDayPhotos.Find(id)) is { } photo)
            db.EndOfDayPhotos.Remove(photo);
    }
}
