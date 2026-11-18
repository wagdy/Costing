using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCompanyStructure : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "identity",
                table: "Users",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "StockMovements",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "StockCounts",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "SalesReceipts",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "SafeTransactions",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "PurchaseInvoices",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "PosZReports",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            migrationBuilder.AddColumn<string>(
                name: "OperatingMode",
                schema: "costing",
                table: "CompanySettings",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "SingleBranch_OpenSpace");

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "BreakageEntries",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            migrationBuilder.CreateTable(
                name: "Branches",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Branches", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "InventoryLocations",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InventoryLocations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InventoryLocations_Branches_BranchId",
                        column: x => x.BranchId,
                        principalSchema: "costing",
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            // The company's first branch, named after it, and its one implicit store: every record
            // made before is theirs (the column's default), before the keys that point at them.
            migrationBuilder.Sql("""
                INSERT INTO costing."Branches" ("Id", "Name", "NameAr", "Type", "IsActive")
                VALUES ('b2a40000-0000-4000-8000-000000000001',
                        COALESCE((SELECT LEFT("Name", 100) FROM costing."CompanySettings" WHERE "Id" = 1), 'Main branch'),
                        NULL, 'Restaurant', TRUE);
                INSERT INTO costing."InventoryLocations" ("Id", "BranchId", "Name", "NameAr", "Kind", "IsActive")
                VALUES ('b2a40000-0000-4000-8000-000000000002', 'b2a40000-0000-4000-8000-000000000001', 'Main Store', 'المخزن الرئيسي', 'MainStore', TRUE);
                """);

            migrationBuilder.CreateIndex(
                name: "IX_Users_BranchId",
                schema: "identity",
                table: "Users",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_BranchId",
                schema: "costing",
                table: "StockMovements",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_StockCounts_BranchId",
                schema: "costing",
                table: "StockCounts",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesReceipts_BranchId",
                schema: "costing",
                table: "SalesReceipts",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_SafeTransactions_BranchId",
                schema: "costing",
                table: "SafeTransactions",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseInvoices_BranchId",
                schema: "costing",
                table: "PurchaseInvoices",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_PosZReports_BranchId",
                schema: "costing",
                table: "PosZReports",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_BreakageEntries_BranchId",
                schema: "costing",
                table: "BreakageEntries",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_InventoryLocations_BranchId",
                schema: "costing",
                table: "InventoryLocations",
                column: "BranchId");

            migrationBuilder.AddForeignKey(
                name: "FK_BreakageEntries_Branches_BranchId",
                schema: "costing",
                table: "BreakageEntries",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PosZReports_Branches_BranchId",
                schema: "costing",
                table: "PosZReports",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseInvoices_Branches_BranchId",
                schema: "costing",
                table: "PurchaseInvoices",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SafeTransactions_Branches_BranchId",
                schema: "costing",
                table: "SafeTransactions",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SalesReceipts_Branches_BranchId",
                schema: "costing",
                table: "SalesReceipts",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_StockCounts_Branches_BranchId",
                schema: "costing",
                table: "StockCounts",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_StockMovements_Branches_BranchId",
                schema: "costing",
                table: "StockMovements",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Users_Branches_BranchId",
                schema: "identity",
                table: "Users",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BreakageEntries_Branches_BranchId",
                schema: "costing",
                table: "BreakageEntries");

            migrationBuilder.DropForeignKey(
                name: "FK_PosZReports_Branches_BranchId",
                schema: "costing",
                table: "PosZReports");

            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseInvoices_Branches_BranchId",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropForeignKey(
                name: "FK_SafeTransactions_Branches_BranchId",
                schema: "costing",
                table: "SafeTransactions");

            migrationBuilder.DropForeignKey(
                name: "FK_SalesReceipts_Branches_BranchId",
                schema: "costing",
                table: "SalesReceipts");

            migrationBuilder.DropForeignKey(
                name: "FK_StockCounts_Branches_BranchId",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropForeignKey(
                name: "FK_StockMovements_Branches_BranchId",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropForeignKey(
                name: "FK_Users_Branches_BranchId",
                schema: "identity",
                table: "Users");

            migrationBuilder.DropTable(
                name: "InventoryLocations",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "Branches",
                schema: "costing");

            migrationBuilder.DropIndex(
                name: "IX_Users_BranchId",
                schema: "identity",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_StockMovements_BranchId",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropIndex(
                name: "IX_StockCounts_BranchId",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropIndex(
                name: "IX_SalesReceipts_BranchId",
                schema: "costing",
                table: "SalesReceipts");

            migrationBuilder.DropIndex(
                name: "IX_SafeTransactions_BranchId",
                schema: "costing",
                table: "SafeTransactions");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseInvoices_BranchId",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropIndex(
                name: "IX_PosZReports_BranchId",
                schema: "costing",
                table: "PosZReports");

            migrationBuilder.DropIndex(
                name: "IX_BreakageEntries_BranchId",
                schema: "costing",
                table: "BreakageEntries");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "identity",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "SalesReceipts");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "SafeTransactions");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "PosZReports");

            migrationBuilder.DropColumn(
                name: "OperatingMode",
                schema: "costing",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "BreakageEntries");
        }
    }
}
