using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "costing");

            migrationBuilder.EnsureSchema(
                name: "identity");

            migrationBuilder.CreateTable(
                name: "AddOns",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Price = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AddOns", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ApprovalRequests",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Module = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RecordId = table.Column<Guid>(type: "uuid", nullable: false),
                    Summary = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    RequestedById = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RequestedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RequestedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DecidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DecidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecisionNote = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    Changes = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApprovalRequests", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CompanySettings",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CurrencySymbol = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    CurrencyPosition = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Country = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    TimeZoneId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    WorkdayStartsAtHour = table.Column<int>(type: "integer", nullable: false),
                    LogoFileName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    LogoContentType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    LogoBytes = table.Column<int>(type: "integer", nullable: true),
                    LogoUpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompanySettings", x => x.Id);
                    table.CheckConstraint("CK_CompanySettings_Single", "\"Id\" = 1");
                });

            migrationBuilder.CreateTable(
                name: "CostingSettings",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    FoodCostTargetPercent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    VarianceTolerancePercent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false, defaultValue: 5m),
                    BeverageCategories = table.Column<List<string>>(type: "text[]", nullable: false, defaultValueSql: "'{}'::text[]"),
                    BreakEvenScenarios = table.Column<List<decimal>>(type: "numeric[]", nullable: false, defaultValueSql: "'{}'::numeric[]")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CostingSettings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "FinancialSettings",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    ServicePercent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    TaxPercent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinancialSettings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ManualSalesSheets",
                schema: "costing",
                columns: table => new
                {
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Month = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ManualSalesSheets", x => new { x.Year, x.Month });
                });

            migrationBuilder.CreateTable(
                name: "MenuCategories",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MenuCategories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MenuItems",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Price = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    IsAvailable = table.Column<bool>(type: "boolean", nullable: false),
                    IsPriceBasedOnAddons = table.Column<bool>(type: "boolean", nullable: false),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    AddOnIds = table.Column<int[]>(type: "integer[]", nullable: false, defaultValueSql: "'{}'::integer[]")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MenuItems", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MonthlyExpenses",
                schema: "costing",
                columns: table => new
                {
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Month = table.Column<int>(type: "integer", nullable: false),
                    WagesAndBenefits = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    LabourHours = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: true),
                    OtherControllableCosts = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    OccupationCost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    Interest = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    Depreciation = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MonthlyExpenses", x => new { x.Year, x.Month });
                });

            migrationBuilder.CreateTable(
                name: "PurchaseCategories",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ExpenseLine = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "RawMaterials"),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseCategories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RecipeCategories",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecipeCategories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SalesReceipts",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Reference = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SoldAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    BusinessDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Channel = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PaymentMethod = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DiscountAmount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    DeliveryFee = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    TaxAmount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    PointsAmount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    RefundedAmount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    Notes = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    Source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    EnteredBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    EnteredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SalesReceipts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Staff",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    JobTitle = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Staff", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "StockCounts",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    StartedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    StartedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PostedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PostedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockCounts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Suppliers",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ContactPerson = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ArchivedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Suppliers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    NormalizedEmail = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    FullName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    PasswordHash = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PasswordSetAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    FailedSignInAttempts = table.Column<int>(type: "integer", nullable: false),
                    LockedUntilUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSignInAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "UserTabAccess",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Tabs = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    SetBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SetAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserTabAccess", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CompanyLogos",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    Content = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompanyLogos", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CompanyLogos_CompanySettings_Id",
                        column: x => x.Id,
                        principalSchema: "costing",
                        principalTable: "CompanySettings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ManualSalesLines",
                schema: "costing",
                columns: table => new
                {
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Month = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ManualSalesLines", x => new { x.Year, x.Month, x.Kind, x.ItemId });
                    table.ForeignKey(
                        name: "FK_ManualSalesLines_ManualSalesSheets_Year_Month",
                        columns: x => new { x.Year, x.Month },
                        principalSchema: "costing",
                        principalTable: "ManualSalesSheets",
                        principalColumns: new[] { "Year", "Month" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MenuItemVariants",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    MenuItemId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Price = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MenuItemVariants", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MenuItemVariants_MenuItems_MenuItemId",
                        column: x => x.MenuItemId,
                        principalSchema: "costing",
                        principalTable: "MenuItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ExpenseItems",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    Unit = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ArchivedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExpenseItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExpenseItems_PurchaseCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalSchema: "costing",
                        principalTable: "PurchaseCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RawMaterials",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Unit = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    QuantityOnHand = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    ReorderLevel = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    Code = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    PurchaseUnit = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PurchaseUnitSize = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    AverageCost = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: true),
                    DefaultYieldPercent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false, defaultValue: 100m),
                    ArchivedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ArchivedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RawMaterials", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RawMaterials_PurchaseCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalSchema: "costing",
                        principalTable: "PurchaseCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Recipes",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RecipeCategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    PlannedPrice = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    TargetKind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    CatalogItemId = table.Column<int>(type: "integer", nullable: true),
                    VariantId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeletedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Portions = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Recipes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Recipes_RecipeCategories_RecipeCategoryId",
                        column: x => x.RecipeCategoryId,
                        principalSchema: "costing",
                        principalTable: "RecipeCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "SalesReceiptLines",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PublicId = table.Column<Guid>(type: "uuid", nullable: false),
                    MenuItemId = table.Column<int>(type: "integer", nullable: false),
                    VariantId = table.Column<int>(type: "integer", nullable: true),
                    MenuItemName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    VariantName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    LineTotal = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    AddOnIds = table.Column<int[]>(type: "integer[]", nullable: false),
                    OnBill = table.Column<bool>(type: "boolean", nullable: false),
                    SalesReceiptId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SalesReceiptLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SalesReceiptLines_SalesReceipts_SalesReceiptId",
                        column: x => x.SalesReceiptId,
                        principalSchema: "costing",
                        principalTable: "SalesReceipts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BreakageEntries",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessDate = table.Column<DateOnly>(type: "date", nullable: false),
                    AssetItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    AssetTransactionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Description = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    UnitCost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    Cost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    Notes = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    RecordedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RecordedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BreakageEntries", x => x.Id);
                    table.CheckConstraint("CK_BreakageEntries_Quantity", "\"Quantity\" > 0");
                    table.ForeignKey(
                        name: "FK_BreakageEntries_Staff_EmployeeId",
                        column: x => x.EmployeeId,
                        principalSchema: "costing",
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PurchaseInvoices",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SupplierId = table.Column<Guid>(type: "uuid", nullable: true),
                    SupplierInvoiceNumber = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    InvoiceDate = table.Column<DateOnly>(type: "date", nullable: true),
                    PaymentMethod = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    RevenueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PostedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PostedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RevisionOf = table.Column<Guid>(type: "uuid", nullable: true),
                    ReplacedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    AttachmentFileName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    AttachmentContentType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    AttachmentBytes = table.Column<int>(type: "integer", nullable: true),
                    AttachedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AttachedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseInvoices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PurchaseInvoices_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalSchema: "costing",
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SupplierLedgerEntries",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SupplierId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    BusinessDate = table.Column<DateOnly>(type: "date", nullable: false),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecordedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RecordedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReversalOf = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SupplierLedgerEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SupplierLedgerEntries_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalSchema: "costing",
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PrepRecipes",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BatchQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    RecipeCategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PrepRecipes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PrepRecipes_RawMaterials_Id",
                        column: x => x.Id,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PrepRecipes_RecipeCategories_RecipeCategoryId",
                        column: x => x.RecipeCategoryId,
                        principalSchema: "costing",
                        principalTable: "RecipeCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "ProductionOrders",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PrepItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlannedQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    ProducedQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    TotalCost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    UnitCost = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    ProducedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ProducedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Notes = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ApprovedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RevisionOf = table.Column<Guid>(type: "uuid", nullable: true),
                    ReplacedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductionOrders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProductionOrders_RawMaterials_PrepItemId",
                        column: x => x.PrepItemId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SharedCosts",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: true),
                    MonthlyAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    Category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SharedCosts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SharedCosts_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StockCountLines",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StockCountId = table.Column<Guid>(type: "uuid", nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    CountedQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    BookQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: true),
                    UnitCost = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockCountLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StockCountLines_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StockCountLines_StockCounts_StockCountId",
                        column: x => x.StockCountId,
                        principalSchema: "costing",
                        principalTable: "StockCounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StockMovements",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    Reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReversalOf = table.Column<Guid>(type: "uuid", nullable: true),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UnitCost = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: true),
                    Note = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RecordedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockMovements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StockMovements_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RecipeIngredients",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeId = table.Column<Guid>(type: "uuid", nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    YieldPercent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false, defaultValue: 100m)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecipeIngredients", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecipeIngredients_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RecipeIngredients_Recipes_RecipeId",
                        column: x => x.RecipeId,
                        principalSchema: "costing",
                        principalTable: "Recipes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PurchaseInvoiceAttachments",
                schema: "costing",
                columns: table => new
                {
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Content = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseInvoiceAttachments", x => x.InvoiceId);
                    table.ForeignKey(
                        name: "FK_PurchaseInvoiceAttachments_PurchaseInvoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalSchema: "costing",
                        principalTable: "PurchaseInvoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PurchaseInvoiceLines",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: true),
                    ExpenseItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    EnteredQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    UnitLabel = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    UnitSize = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    Cost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseInvoiceLines", x => x.Id);
                    table.CheckConstraint("CK_PurchaseInvoiceLines_Item", "(\"ItemType\" = 'Inventory' AND \"RawMaterialId\" IS NOT NULL AND \"ExpenseItemId\" IS NULL) OR (\"ItemType\" = 'Expense' AND \"ExpenseItemId\" IS NOT NULL AND \"RawMaterialId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_PurchaseInvoiceLines_ExpenseItems_ExpenseItemId",
                        column: x => x.ExpenseItemId,
                        principalSchema: "costing",
                        principalTable: "ExpenseItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PurchaseInvoiceLines_PurchaseInvoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalSchema: "costing",
                        principalTable: "PurchaseInvoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PurchaseInvoiceLines_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SafeTransactions",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Fund = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    BusinessDate = table.Column<DateOnly>(type: "date", nullable: false),
                    RevenueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    SupplierId = table.Column<Guid>(type: "uuid", nullable: true),
                    PurchaseInvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    ExpenseItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    PayrollMonth = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    GrossAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    IncludesTax = table.Column<bool>(type: "boolean", nullable: false),
                    TaxPercent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: true),
                    TaxAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    RecordedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RecordedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ApprovedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ReversalOf = table.Column<Guid>(type: "uuid", nullable: true),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SafeTransactions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SafeTransactions_ExpenseItems_ExpenseItemId",
                        column: x => x.ExpenseItemId,
                        principalSchema: "costing",
                        principalTable: "ExpenseItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SafeTransactions_PurchaseInvoices_PurchaseInvoiceId",
                        column: x => x.PurchaseInvoiceId,
                        principalSchema: "costing",
                        principalTable: "PurchaseInvoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SafeTransactions_SafeTransactions_ReversalOf",
                        column: x => x.ReversalOf,
                        principalSchema: "costing",
                        principalTable: "SafeTransactions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SafeTransactions_Staff_EmployeeId",
                        column: x => x.EmployeeId,
                        principalSchema: "costing",
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SafeTransactions_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalSchema: "costing",
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PrepRecipeIngredients",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PrepRecipeId = table.Column<Guid>(type: "uuid", nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    YieldPercent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PrepRecipeIngredients", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PrepRecipeIngredients_PrepRecipes_PrepRecipeId",
                        column: x => x.PrepRecipeId,
                        principalSchema: "costing",
                        principalTable: "PrepRecipes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PrepRecipeIngredients_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ProductionOrderLines",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductionOrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    UnitCost = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    Cost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductionOrderLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProductionOrderLines_ProductionOrders_ProductionOrderId",
                        column: x => x.ProductionOrderId,
                        principalSchema: "costing",
                        principalTable: "ProductionOrders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ProductionOrderLines_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ApprovalRequests_RecordId",
                schema: "costing",
                table: "ApprovalRequests",
                column: "RecordId",
                unique: true,
                filter: "\"Status\" = 'Pending'");

            migrationBuilder.CreateIndex(
                name: "IX_ApprovalRequests_Status_RequestedAtUtc",
                schema: "costing",
                table: "ApprovalRequests",
                columns: new[] { "Status", "RequestedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_BreakageEntries_BusinessDate",
                schema: "costing",
                table: "BreakageEntries",
                column: "BusinessDate");

            migrationBuilder.CreateIndex(
                name: "IX_BreakageEntries_EmployeeId",
                schema: "costing",
                table: "BreakageEntries",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseItems_CategoryId",
                schema: "costing",
                table: "ExpenseItems",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseItems_NormalizedName",
                schema: "costing",
                table: "ExpenseItems",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MenuCategories_Name",
                schema: "costing",
                table: "MenuCategories",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MenuItems_Category",
                schema: "costing",
                table: "MenuItems",
                column: "Category");

            migrationBuilder.CreateIndex(
                name: "IX_MenuItemVariants_MenuItemId",
                schema: "costing",
                table: "MenuItemVariants",
                column: "MenuItemId");

            migrationBuilder.CreateIndex(
                name: "IX_PrepRecipeIngredients_PrepRecipeId_RawMaterialId",
                schema: "costing",
                table: "PrepRecipeIngredients",
                columns: new[] { "PrepRecipeId", "RawMaterialId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PrepRecipeIngredients_RawMaterialId",
                schema: "costing",
                table: "PrepRecipeIngredients",
                column: "RawMaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_PrepRecipes_RecipeCategoryId",
                schema: "costing",
                table: "PrepRecipes",
                column: "RecipeCategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductionOrderLines_ProductionOrderId_RawMaterialId",
                schema: "costing",
                table: "ProductionOrderLines",
                columns: new[] { "ProductionOrderId", "RawMaterialId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProductionOrderLines_RawMaterialId",
                schema: "costing",
                table: "ProductionOrderLines",
                column: "RawMaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductionOrders_PrepItemId_ProducedAtUtc",
                schema: "costing",
                table: "ProductionOrders",
                columns: new[] { "PrepItemId", "ProducedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ProductionOrders_ProducedAtUtc",
                schema: "costing",
                table: "ProductionOrders",
                column: "ProducedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseCategories_NormalizedName",
                schema: "costing",
                table: "PurchaseCategories",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseInvoiceLines_ExpenseItemId",
                schema: "costing",
                table: "PurchaseInvoiceLines",
                column: "ExpenseItemId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseInvoiceLines_InvoiceId_ExpenseItemId",
                schema: "costing",
                table: "PurchaseInvoiceLines",
                columns: new[] { "InvoiceId", "ExpenseItemId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseInvoiceLines_InvoiceId_RawMaterialId",
                schema: "costing",
                table: "PurchaseInvoiceLines",
                columns: new[] { "InvoiceId", "RawMaterialId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseInvoiceLines_RawMaterialId",
                schema: "costing",
                table: "PurchaseInvoiceLines",
                column: "RawMaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseInvoices_Status_PostedAtUtc",
                schema: "costing",
                table: "PurchaseInvoices",
                columns: new[] { "Status", "PostedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseInvoices_SupplierId",
                schema: "costing",
                table: "PurchaseInvoices",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_RawMaterials_CategoryId",
                schema: "costing",
                table: "RawMaterials",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_RecipeCategories_NormalizedName",
                schema: "costing",
                table: "RecipeCategories",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RecipeIngredients_RawMaterialId",
                schema: "costing",
                table: "RecipeIngredients",
                column: "RawMaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_RecipeIngredients_RecipeId_RawMaterialId",
                schema: "costing",
                table: "RecipeIngredients",
                columns: new[] { "RecipeId", "RawMaterialId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Recipes_RecipeCategoryId",
                schema: "costing",
                table: "Recipes",
                column: "RecipeCategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_Recipes_TargetKind_CatalogItemId_VariantId",
                schema: "costing",
                table: "Recipes",
                columns: new[] { "TargetKind", "CatalogItemId", "VariantId" },
                unique: true,
                filter: "\"DeletedAtUtc\" IS NULL AND \"CatalogItemId\" IS NOT NULL")
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_SafeTransactions_EmployeeId_PayrollMonth",
                schema: "costing",
                table: "SafeTransactions",
                columns: new[] { "EmployeeId", "PayrollMonth" },
                filter: "\"EmployeeId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SafeTransactions_ExpenseItemId",
                schema: "costing",
                table: "SafeTransactions",
                column: "ExpenseItemId");

            migrationBuilder.CreateIndex(
                name: "IX_SafeTransactions_Fund_BusinessDate",
                schema: "costing",
                table: "SafeTransactions",
                columns: new[] { "Fund", "BusinessDate" });

            migrationBuilder.CreateIndex(
                name: "IX_SafeTransactions_PurchaseInvoiceId",
                schema: "costing",
                table: "SafeTransactions",
                column: "PurchaseInvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_SafeTransactions_RevenueDate",
                schema: "costing",
                table: "SafeTransactions",
                column: "RevenueDate");

            migrationBuilder.CreateIndex(
                name: "IX_SafeTransactions_ReversalOf",
                schema: "costing",
                table: "SafeTransactions",
                column: "ReversalOf",
                unique: true,
                filter: "\"ReversalOf\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SafeTransactions_SupplierId",
                schema: "costing",
                table: "SafeTransactions",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesReceiptLines_MenuItemId",
                schema: "costing",
                table: "SalesReceiptLines",
                column: "MenuItemId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesReceiptLines_PublicId",
                schema: "costing",
                table: "SalesReceiptLines",
                column: "PublicId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SalesReceiptLines_SalesReceiptId",
                schema: "costing",
                table: "SalesReceiptLines",
                column: "SalesReceiptId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesReceipts_BusinessDate",
                schema: "costing",
                table: "SalesReceipts",
                column: "BusinessDate");

            migrationBuilder.CreateIndex(
                name: "IX_SalesReceipts_Reference",
                schema: "costing",
                table: "SalesReceipts",
                column: "Reference",
                unique: true,
                filter: "\"Reference\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SalesReceipts_SoldAtUtc",
                schema: "costing",
                table: "SalesReceipts",
                column: "SoldAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_SharedCosts_RawMaterialId",
                schema: "costing",
                table: "SharedCosts",
                column: "RawMaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_StockCountLines_RawMaterialId",
                schema: "costing",
                table: "StockCountLines",
                column: "RawMaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_StockCountLines_StockCountId_RawMaterialId",
                schema: "costing",
                table: "StockCountLines",
                columns: new[] { "StockCountId", "RawMaterialId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StockCounts_Status",
                schema: "costing",
                table: "StockCounts",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_RawMaterialId_OccurredAtUtc",
                schema: "costing",
                table: "StockMovements",
                columns: new[] { "RawMaterialId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_SourceId_Reason_RawMaterialId_ReversalOf",
                schema: "costing",
                table: "StockMovements",
                columns: new[] { "SourceId", "Reason", "RawMaterialId", "ReversalOf" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_SupplierLedgerEntries_SourceId_ReversalOf",
                schema: "costing",
                table: "SupplierLedgerEntries",
                columns: new[] { "SourceId", "ReversalOf" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_SupplierLedgerEntries_SupplierId_BusinessDate",
                schema: "costing",
                table: "SupplierLedgerEntries",
                columns: new[] { "SupplierId", "BusinessDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Suppliers_NormalizedName",
                schema: "costing",
                table: "Suppliers",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_NormalizedEmail",
                schema: "identity",
                table: "Users",
                column: "NormalizedEmail",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserTabAccess_UserId",
                schema: "costing",
                table: "UserTabAccess",
                column: "UserId",
                unique: true);

            // The two general categories every material and expense item falls back to, as
            // PurchaseCategory.General() and GeneralExpenses() make them.
            migrationBuilder.Sql("""
                INSERT INTO costing."PurchaseCategories" ("Id", "Name", "NormalizedName", "NameAr", "ExpenseLine", "Kind", "CreatedAtUtc") VALUES
                    ('3f3f4d50-4158-44c8-bb35-e3dd347717ea', 'General', 'GENERAL', 'عام', 'Controllable', 'RawMaterials', now()),
                    ('8c2d3b6e-1f4a-4c55-9e1d-6a7b0f2e9c41', 'General expenses', 'GENERAL EXPENSES', 'مصروفات عامة', 'Controllable', 'Expenses', now())
                ON CONFLICT DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AddOns",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "ApprovalRequests",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "BreakageEntries",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "CompanyLogos",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "CostingSettings",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "FinancialSettings",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "ManualSalesLines",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "MenuCategories",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "MenuItemVariants",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "MonthlyExpenses",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PrepRecipeIngredients",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "ProductionOrderLines",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PurchaseInvoiceAttachments",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PurchaseInvoiceLines",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "RecipeIngredients",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "SafeTransactions",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "SalesReceiptLines",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "SharedCosts",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "StockCountLines",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "StockMovements",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "SupplierLedgerEntries",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "Users",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "UserTabAccess",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "CompanySettings",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "ManualSalesSheets",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "MenuItems",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PrepRecipes",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "ProductionOrders",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "Recipes",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "ExpenseItems",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PurchaseInvoices",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "Staff",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "SalesReceipts",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "StockCounts",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "RawMaterials",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "RecipeCategories",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "Suppliers",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PurchaseCategories",
                schema: "costing");
        }
    }
}
