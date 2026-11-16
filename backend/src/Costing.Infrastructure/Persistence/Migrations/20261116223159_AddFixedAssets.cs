using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddFixedAssets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "FixedAssetId",
                schema: "costing",
                table: "SafeTransactions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "FixedAssets",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    AssetCode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Category = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Location = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    PurchaseDate = table.Column<DateOnly>(type: "date", nullable: false),
                    PurchaseCost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    SalvageValue = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    UsefulLifeMonths = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PaidFrom = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    PurchaseTransactionId = table.Column<Guid>(type: "uuid", nullable: true),
                    DisposalDate = table.Column<DateOnly>(type: "date", nullable: true),
                    SaleProceeds = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    SaleFund = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    SaleTransactionId = table.Column<Guid>(type: "uuid", nullable: true),
                    DisposalNotes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    DisposedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FixedAssets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FixedAssets_SafeTransactions_PurchaseTransactionId",
                        column: x => x.PurchaseTransactionId,
                        principalSchema: "costing",
                        principalTable: "SafeTransactions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FixedAssets_SafeTransactions_SaleTransactionId",
                        column: x => x.SaleTransactionId,
                        principalSchema: "costing",
                        principalTable: "SafeTransactions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SafeTransactions_FixedAssetId",
                schema: "costing",
                table: "SafeTransactions",
                column: "FixedAssetId",
                filter: "\"FixedAssetId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_FixedAssets_AssetCode",
                schema: "costing",
                table: "FixedAssets",
                column: "AssetCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FixedAssets_Number",
                schema: "costing",
                table: "FixedAssets",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FixedAssets_PurchaseTransactionId",
                schema: "costing",
                table: "FixedAssets",
                column: "PurchaseTransactionId");

            migrationBuilder.CreateIndex(
                name: "IX_FixedAssets_SaleTransactionId",
                schema: "costing",
                table: "FixedAssets",
                column: "SaleTransactionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FixedAssets",
                schema: "costing");

            migrationBuilder.DropIndex(
                name: "IX_SafeTransactions_FixedAssetId",
                schema: "costing",
                table: "SafeTransactions");

            migrationBuilder.DropColumn(
                name: "FixedAssetId",
                schema: "costing",
                table: "SafeTransactions");
        }
    }
}
