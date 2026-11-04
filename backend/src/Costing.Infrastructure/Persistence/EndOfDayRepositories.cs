using Microsoft.EntityFrameworkCore;
using Costing.Domain.EndOfDay;

namespace Costing.Infrastructure.Persistence;

internal sealed class EndOfDayRepository(CostingDbContext db) : IEndOfDayRepository
{
    private IQueryable<EndOfDayReport> WithInvoices => db.EndOfDayReports.Include(d => d.Invoices);

    public Task<EndOfDayReport?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
        WithInvoices.SingleOrDefaultAsync(d => d.Id == id, cancellationToken);

    public void Add(EndOfDayReport aggregate) => db.EndOfDayReports.Add(aggregate);

    public Task<EndOfDayReport?> GetByDateAsync(DateOnly date, CancellationToken cancellationToken = default) =>
        WithInvoices.SingleOrDefaultAsync(d => d.Date == date, cancellationToken);

    public async Task<IReadOnlyList<EndOfDayReport>> GetBetweenAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default) =>
        await WithInvoices.Where(d => d.Date >= from && d.Date <= to).ToListAsync(cancellationToken);

    public Task<EndOfDayReport?> GetByInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default) =>
        WithInvoices.SingleOrDefaultAsync(d => d.Invoices.Any(i => i.Id == invoiceId), cancellationToken);
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
