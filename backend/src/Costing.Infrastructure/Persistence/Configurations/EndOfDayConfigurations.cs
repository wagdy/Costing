using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.EndOfDay;
using Costing.Domain.Purchases;
using Costing.Domain.Staff;
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
        builder.Property(d => d.DiscountsAmount).HasPrecision(18, 2);
        builder.HasDiscountReasons();
        builder.Property(d => d.OpeningFloat).HasPrecision(18, 2);
        // From the POS: its shifts, the cash's own tax, and a manager's override of its figures.
        builder.Property(d => d.PosShifts).HasMaxLength(200);
        builder.Property(d => d.CashTaxAmount).HasPrecision(18, 2);
        builder.Property(d => d.SalesOverriddenBy).HasMaxLength(200);
        builder.Property(d => d.SalesOverrideNote).HasMaxLength(EndOfDayReport.MaxAuditReason);
        builder.Ignore(d => d.SalesLocked);
        builder.Ignore(d => d.FromPos);
        builder.Property(d => d.Notes).HasMaxLength(EndOfDayReport.MaxDayNotes);
        builder.Property(d => d.ClosedDayReason).HasMaxLength(EndOfDayReport.MaxAuditReason);
        builder.Property(d => d.SalesPhotoFileName).HasMaxLength(200);
        builder.Property(d => d.SalesPhotoContentType).HasMaxLength(64);
        builder.Property(d => d.CreatedBy).HasMaxLength(200);
        builder.Property(d => d.UpdatedBy).HasMaxLength(200);
        builder.Property(d => d.SubmittedBy).HasMaxLength(200);
        builder.Property(d => d.ReopenedBy).HasMaxLength(200);
        builder.Property(d => d.ReopenReason).HasMaxLength(EndOfDayReport.MaxNotes);
        builder.Ignore(d => d.SalesPhoto);
        builder.Ignore(d => d.IsSubmitted);
        builder.Ignore(d => d.NetSales);
        builder.Ignore(d => d.TotalRevenue);
        builder.Ignore(d => d.CashAfterInvoices);
        builder.Ignore(d => d.ExpectedIntoSafe);
        builder.Ignore(d => d.CashTax);
        builder.Ignore(d => d.CashSalesCollected);
        builder.Ignore(d => d.CashPaidOut);
        builder.Ignore(d => d.NetCashInTill);
        builder.HasMany(d => d.Invoices).WithOne().HasForeignKey(i => i.ReportId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(d => d.Invoices).HasField("_invoices").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasMany(d => d.Payouts).WithOne().HasForeignKey(p => p.ReportId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(d => d.Payouts).HasField("_payouts").UsePropertyAccessMode(PropertyAccessMode.Field);
        // One a business day in each branch.
        builder.Property(d => d.BranchId).HasDefaultValue(Domain.Company.Branch.DefaultId).HasSentinel(Guid.Empty);
        builder.HasIndex(d => new { d.BranchId, d.Date }).IsUnique();
        builder.HasOne<Domain.Company.Branch>().WithMany().HasForeignKey(d => d.BranchId).OnDelete(DeleteBehavior.Restrict);
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
        builder.HasOne<Domain.Purchases.PurchaseOrder>().WithMany().HasForeignKey(i => i.PurchaseOrderId).OnDelete(DeleteBehavior.Restrict);
        // A purchase invoice is the one an invoice handed in was posted as, once.
        builder.HasOne<PurchaseInvoice>().WithMany().HasForeignKey(i => i.PurchaseInvoiceId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(i => i.PurchaseInvoiceId).IsUnique();
    }
}

// Cash paid out of the till on the day: to a supplier or an employee, with its receipt.
internal sealed class EndOfDayPayoutConfiguration : IEntityTypeConfiguration<EndOfDayPayout>
{
    public void Configure(EntityTypeBuilder<EndOfDayPayout> builder)
    {
        builder.ToTable("EndOfDayPayouts", CostingDbContext.CostingSchema);
        builder.Property(p => p.Kind).IsEnumName();
        builder.Property(p => p.Amount).HasPrecision(18, 2);
        builder.Property(p => p.Note).HasMaxLength(EndOfDayReport.MaxPayoutNote);
        builder.Property(p => p.ReceiptFileName).HasMaxLength(200);
        builder.Property(p => p.ReceiptContentType).HasMaxLength(64);
        builder.Ignore(p => p.Receipt);
        builder.Ignore(p => p.PayeeId);
        // The safe entry it is made: found by it, as the HR link and a voided day find their payment.
        builder.HasIndex(p => p.VoucherId).IsUnique();
        builder.HasOne<Supplier>().WithMany().HasForeignKey(p => p.SupplierId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<StaffMember>().WithMany().HasForeignKey(p => p.EmployeeId).OnDelete(DeleteBehavior.Restrict);
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
