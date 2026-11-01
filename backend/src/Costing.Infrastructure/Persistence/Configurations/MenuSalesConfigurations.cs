using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Costing.Domain.Access;
using Costing.Domain.Menu;
using Costing.Domain.Sales;
using Costing.Domain.Staff;

namespace Costing.Infrastructure.Persistence.Configurations;

internal sealed class MenuCategoryConfiguration : IEntityTypeConfiguration<MenuCategory>
{
    public void Configure(EntityTypeBuilder<MenuCategory> builder)
    {
        builder.ToTable("MenuCategories", CostingDbContext.CostingSchema);
        builder.Property(c => c.Id).UseIdentityByDefaultColumn();
        builder.Property(c => c.Name).HasMaxLength(MenuCategory.MaxNameLength);
        builder.Property(c => c.NameAr).HasMaxLength(MenuCategory.MaxNameLength);
        builder.HasIndex(c => c.Name).IsUnique();
    }
}

// An item's number is given (its code on the reports), never generated.
internal sealed class MenuItemConfiguration : IEntityTypeConfiguration<MenuItem>
{
    public void Configure(EntityTypeBuilder<MenuItem> builder)
    {
        builder.ToTable("MenuItems", CostingDbContext.CostingSchema);
        builder.Property(m => m.Id).ValueGeneratedNever();
        builder.Property(m => m.Name).HasMaxLength(MenuItem.MaxNameLength);
        builder.Property(m => m.NameAr).HasMaxLength(MenuItem.MaxNameLength);
        builder.Property(m => m.Category).HasMaxLength(MenuCategory.MaxNameLength);
        builder.Property(m => m.AddOnIds).HasDefaultValueSql("'{}'::integer[]");
        builder.HasIndex(m => m.Category);
        builder.HasMany(m => m.Variants).WithOne().HasForeignKey(v => v.MenuItemId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(m => m.Variants).AutoInclude();
    }
}

internal sealed class MenuItemVariantConfiguration : IEntityTypeConfiguration<MenuItemVariant>
{
    public void Configure(EntityTypeBuilder<MenuItemVariant> builder)
    {
        builder.ToTable("MenuItemVariants", CostingDbContext.CostingSchema);
        builder.Property(v => v.Id).UseIdentityByDefaultColumn();
        builder.Property(v => v.Name).HasMaxLength(MenuItem.MaxNameLength);
        builder.Property(v => v.NameAr).HasMaxLength(MenuItem.MaxNameLength);
    }
}

internal sealed class AddOnConfiguration : IEntityTypeConfiguration<AddOn>
{
    public void Configure(EntityTypeBuilder<AddOn> builder)
    {
        builder.ToTable("AddOns", CostingDbContext.CostingSchema);
        builder.Property(a => a.Id).UseIdentityByDefaultColumn();
        builder.Property(a => a.Name).HasMaxLength(MenuItem.MaxNameLength);
        builder.Property(a => a.NameAr).HasMaxLength(MenuItem.MaxNameLength);
    }
}

internal sealed class SalesReceiptConfiguration : IEntityTypeConfiguration<SalesReceipt>
{
    public void Configure(EntityTypeBuilder<SalesReceipt> builder)
    {
        builder.ToTable("SalesReceipts", CostingDbContext.CostingSchema);
        builder.Property(r => r.Reference).HasMaxLength(SalesReceipt.MaxReferenceLength);
        builder.HasIndex(r => r.Reference).IsUnique().HasFilter("\"Reference\" IS NOT NULL");
        builder.HasIndex(r => r.SoldAtUtc);
        builder.HasIndex(r => r.BusinessDate);
        builder.Property(r => r.Channel).IsEnumName();
        builder.Property(r => r.PaymentMethod).IsEnumName();
        builder.Property(r => r.Source).IsEnumName();
        builder.Property(r => r.Notes).HasMaxLength(300);
        builder.Property(r => r.EnteredBy).HasMaxLength(200);
        builder.Property(r => r.VoidedBy).HasMaxLength(200);
        builder.Ignore(r => r.IsOnline);
        builder.Ignore(r => r.BilledSubtotal);
        builder.Ignore(r => r.IsVoided);
        builder.OwnsMany(r => r.Lines, line =>
        {
            line.ToTable("SalesReceiptLines", CostingDbContext.CostingSchema);
            line.WithOwner().HasForeignKey("SalesReceiptId");
            line.Property<int>("Id").UseIdentityByDefaultColumn();
            line.HasKey("Id");
            line.HasIndex(l => l.PublicId).IsUnique();
            line.HasIndex(l => l.MenuItemId);
            line.Property(l => l.MenuItemName).HasMaxLength(MenuItem.MaxNameLength);
            line.Property(l => l.VariantName).HasMaxLength(MenuItem.MaxNameLength);
        });
        builder.Navigation(r => r.Lines).AutoInclude();
    }
}

internal sealed class StaffMemberConfiguration : IEntityTypeConfiguration<StaffMember>
{
    public void Configure(EntityTypeBuilder<StaffMember> builder)
    {
        builder.ToTable("Staff", CostingDbContext.CostingSchema);
        builder.Property(s => s.Name).HasMaxLength(StaffMember.MaxNameLength);
        builder.Property(s => s.JobTitle).HasMaxLength(100);
    }
}

internal sealed class UserTabAccessConfiguration : IEntityTypeConfiguration<UserTabAccess>
{
    public void Configure(EntityTypeBuilder<UserTabAccess> builder)
    {
        builder.ToTable("UserTabAccess", CostingDbContext.CostingSchema);
        builder.Property(a => a.UserId).HasMaxLength(UserTabAccess.MaxUserIdLength);
        builder.HasIndex(a => a.UserId).IsUnique();
        builder.Property(a => a.Tabs).HasConversion<string>().HasMaxLength(300);
        builder.Property(a => a.SetBy).HasMaxLength(200);
    }
}
