using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.Company;
using Costing.Infrastructure.Persistence;
using Costing.Infrastructure.Persistence.Configurations;

namespace Costing.Infrastructure.Company;

// The logo's bytes: one row, apart from the settings, so reading them never loads the picture.
public sealed class CompanyLogo
{
    public int Id { get; init; } = CompanySettings.SingletonId;
    public byte[] Content { get; set; } = [];
}

internal sealed class CompanySettingsStore(CostingDbContext db) : ICompanySettingsStore
{
    public Task<CompanySettings?> GetAsync(CancellationToken cancellationToken = default) =>
        db.CompanySettings.SingleOrDefaultAsync(s => s.Id == CompanySettings.SingletonId, cancellationToken);

    public void Add(CompanySettings settings) => db.CompanySettings.Add(settings);

    public async Task PutLogoAsync(byte[]? content, CancellationToken cancellationToken = default)
    {
        var existing = await db.CompanyLogos.FindAsync([CompanySettings.SingletonId], cancellationToken);
        if (content is null)
        {
            if (existing is not null)
                db.CompanyLogos.Remove(existing);
        }
        else if (existing is null)
        {
            db.CompanyLogos.Add(new CompanyLogo { Content = content });
        }
        else
        {
            existing.Content = content;
        }
    }

    public async Task<byte[]?> GetLogoAsync(CancellationToken cancellationToken = default) =>
        await db.CompanyLogos.AsNoTracking()
            .Where(l => l.Id == CompanySettings.SingletonId)
            .Select(l => l.Content)
            .SingleOrDefaultAsync(cancellationToken);
}

internal sealed class CompanySettingsConfiguration : IEntityTypeConfiguration<CompanySettings>
{
    public void Configure(EntityTypeBuilder<CompanySettings> builder)
    {
        builder.ToTable("CompanySettings", CostingDbContext.CostingSchema, t => t.HasCheckConstraint("CK_CompanySettings_Single", $"\"Id\" = {CompanySettings.SingletonId}"));
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.Name).HasMaxLength(CompanySettings.MaxNameLength);
        builder.Property(s => s.CurrencySymbol).HasMaxLength(CompanySettings.MaxCurrencySymbolLength);
        builder.Property(s => s.CurrencyPosition).IsEnumName();
        builder.Property(s => s.Country).IsEnumName();
        builder.Property(s => s.TimeZoneId).HasMaxLength(64);
        builder.Property(s => s.LogoFileName).HasMaxLength(CompanySettings.MaxLogoFileNameLength);
        builder.Property(s => s.LogoContentType).HasMaxLength(50);
        builder.Property(s => s.UpdatedBy).HasMaxLength(200);
    }
}

internal sealed class CompanyLogoConfiguration : IEntityTypeConfiguration<CompanyLogo>
{
    public void Configure(EntityTypeBuilder<CompanyLogo> builder)
    {
        builder.ToTable("CompanyLogos", CostingDbContext.CostingSchema);
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.HasOne<CompanySettings>().WithOne().HasForeignKey<CompanyLogo>(l => l.Id).OnDelete(DeleteBehavior.Cascade);
    }
}
