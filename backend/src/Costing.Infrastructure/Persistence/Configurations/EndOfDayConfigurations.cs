using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.EndOfDay;
using Costing.Domain.Purchases;
using Costing.Domain.Suppliers;

namespace Costing.Infrastructure.Persistence.Configurations;

internal sealed class EndOfDayReportConfiguration : IEntityTypeConfiguration<EndOfDayReport>
{
    public void Configure(EntityTypeBuilder<EndOfDayReport> builder)
    {
        builder.ToTable("EndOfDayReports", CostingDbContext.CostingSchema);
        builder.Property(d => d.Status).IsEnumName();
        builder.Property(d => d.CashAmount).HasPrecision(18, 2);
        builder.Property(d => d.CardAmount).HasPrecision(18, 2);
        builder.Property(d => d.TaxAmount).HasPrecision(18, 2);
        builder.Property(d => d.VoidsAmount).HasPrecision(18, 2);
        builder.Property(d => d.Notes).HasMaxLength(EndOfDayReport.MaxNotes);
        builder.Property(d => d.SalesPhotoFileName).HasMaxLength(200);
        builder.Property(d => d.SalesPhotoContentType).HasMaxLength(64);
        builder.Property(d => d.CreatedBy).HasMaxLength(200);
        builder.Property(d => d.UpdatedBy).HasMaxLength(200);
        builder.Property(d => d.SubmittedBy).HasMaxLength(200);
        builder.Property(d => d.ReopenedBy).HasMaxLength(200);
        builder.Ignore(d => d.SalesPhoto);
        builder.Ignore(d => d.IsSubmitted);
        builder.Ignore(d => d.NetSales);
        builder.Ignore(d => d.TotalRevenue);
        builder.Ignore(d => d.CashAfterInvoices);
        builder.Ignore(d => d.ExpectedIntoSafe);
        builder.HasMany(d => d.Invoices).WithOne().HasForeignKey(i => i.ReportId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(d => d.Invoices).HasField("_invoices").UsePropertyAccessMode(PropertyAccessMode.Field);
        // One a business day.
        builder.HasIndex(d => d.Date).IsUnique();
    }
}

internal sealed class EndOfDayInvoiceConfiguration : IEntityTypeConfiguration<EndOfDayInvoice>
{
    public void Configure(EntityTypeBuilder<EndOfDayInvoice> builder)
    {
        builder.ToTable("EndOfDayInvoices", CostingDbContext.CostingSchema);
        builder.Property(i => i.Kind).IsEnumName();
        builder.Property(i => i.ReportedTotal).HasPrecision(18, 2);
        builder.Property(i => i.Note).HasMaxLength(EndOfDayReport.MaxInvoiceNote);
        builder.Property(i => i.PhotoFileName).HasMaxLength(200);
        builder.Property(i => i.PhotoContentType).HasMaxLength(64);
        builder.Ignore(i => i.Photo);
        builder.HasOne<Supplier>().WithMany().HasForeignKey(i => i.SupplierId).OnDelete(DeleteBehavior.Restrict);
        // A purchase invoice is the one an invoice handed in was posted as, once.
        builder.HasOne<PurchaseInvoice>().WithMany().HasForeignKey(i => i.PurchaseInvoiceId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(i => i.PurchaseInvoiceId).IsUnique();
    }
}

internal sealed class EndOfDayPhotoContentConfiguration : IEntityTypeConfiguration<EndOfDayPhotoContent>
{
    public void Configure(EntityTypeBuilder<EndOfDayPhotoContent> builder)
    {
        builder.ToTable("EndOfDayPhotos", CostingDbContext.CostingSchema);
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).ValueGeneratedNever();
    }
}
