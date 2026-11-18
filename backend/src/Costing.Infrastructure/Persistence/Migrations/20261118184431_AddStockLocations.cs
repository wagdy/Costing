using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddStockLocations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "LocationId",
                schema: "costing",
                table: "StockMovements",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000002"));

            migrationBuilder.AddColumn<Guid>(
                name: "LocationId",
                schema: "costing",
                table: "StockCounts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LocationId",
                schema: "costing",
                table: "PurchaseInvoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LocationId",
                schema: "costing",
                table: "ProductionOrders",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid[]>(
                name: "StationIds",
                schema: "costing",
                table: "InventoryLocations",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.CreateTable(
                name: "InternalTransfers",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    TransferDate = table.Column<DateOnly>(type: "date", nullable: false),
                    FromLocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ToLocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedByUserId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InternalTransfers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InternalTransfers_Branches_BranchId",
                        column: x => x.BranchId,
                        principalSchema: "costing",
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InternalTransfers_InventoryLocations_FromLocationId",
                        column: x => x.FromLocationId,
                        principalSchema: "costing",
                        principalTable: "InventoryLocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InternalTransfers_InventoryLocations_ToLocationId",
                        column: x => x.ToLocationId,
                        principalSchema: "costing",
                        principalTable: "InventoryLocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MaterialBranchStocks",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    BranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    AverageCost = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MaterialBranchStocks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MaterialBranchStocks_Branches_BranchId",
                        column: x => x.BranchId,
                        principalSchema: "costing",
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaterialBranchStocks_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "InternalTransferLines",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InternalTransferId = table.Column<Guid>(type: "uuid", nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    UnitCostSnapshot = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    LineTotalCost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InternalTransferLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InternalTransferLines_InternalTransfers_InternalTransferId",
                        column: x => x.InternalTransferId,
                        principalSchema: "costing",
                        principalTable: "InternalTransfers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_InternalTransferLines_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            // Each material's cost, as the company had it, the first branch's own: on upgrade nothing
            // is lost (its stock is its entries', every one of them the Main Store's).
            migrationBuilder.Sql("""
                INSERT INTO costing."MaterialBranchStocks" ("Id", "RawMaterialId", "BranchId", "AverageCost")
                SELECT gen_random_uuid(), m."Id", 'b2a40000-0000-4000-8000-000000000001', m."AverageCost"
                FROM costing."RawMaterials" m;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_LocationId",
                schema: "costing",
                table: "StockMovements",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_RawMaterialId_LocationId",
                schema: "costing",
                table: "StockMovements",
                columns: new[] { "RawMaterialId", "LocationId" });

            migrationBuilder.CreateIndex(
                name: "IX_StockCounts_LocationId",
                schema: "costing",
                table: "StockCounts",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseInvoices_LocationId",
                schema: "costing",
                table: "PurchaseInvoices",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductionOrders_LocationId",
                schema: "costing",
                table: "ProductionOrders",
                column: "LocationId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalTransferLines_InternalTransferId",
                schema: "costing",
                table: "InternalTransferLines",
                column: "InternalTransferId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalTransferLines_RawMaterialId",
                schema: "costing",
                table: "InternalTransferLines",
                column: "RawMaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalTransfers_BranchId_TransferDate",
                schema: "costing",
                table: "InternalTransfers",
                columns: new[] { "BranchId", "TransferDate" });

            migrationBuilder.CreateIndex(
                name: "IX_InternalTransfers_FromLocationId",
                schema: "costing",
                table: "InternalTransfers",
                column: "FromLocationId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalTransfers_Number",
                schema: "costing",
                table: "InternalTransfers",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InternalTransfers_ToLocationId",
                schema: "costing",
                table: "InternalTransfers",
                column: "ToLocationId");

            migrationBuilder.CreateIndex(
                name: "IX_MaterialBranchStocks_BranchId",
                schema: "costing",
                table: "MaterialBranchStocks",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_MaterialBranchStocks_RawMaterialId_BranchId",
                schema: "costing",
                table: "MaterialBranchStocks",
                columns: new[] { "RawMaterialId", "BranchId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_ProductionOrders_InventoryLocations_LocationId",
                schema: "costing",
                table: "ProductionOrders",
                column: "LocationId",
                principalSchema: "costing",
                principalTable: "InventoryLocations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseInvoices_InventoryLocations_LocationId",
                schema: "costing",
                table: "PurchaseInvoices",
                column: "LocationId",
                principalSchema: "costing",
                principalTable: "InventoryLocations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_StockCounts_InventoryLocations_LocationId",
                schema: "costing",
                table: "StockCounts",
                column: "LocationId",
                principalSchema: "costing",
                principalTable: "InventoryLocations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_StockMovements_InventoryLocations_LocationId",
                schema: "costing",
                table: "StockMovements",
                column: "LocationId",
                principalSchema: "costing",
                principalTable: "InventoryLocations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ProductionOrders_InventoryLocations_LocationId",
                schema: "costing",
                table: "ProductionOrders");

            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseInvoices_InventoryLocations_LocationId",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropForeignKey(
                name: "FK_StockCounts_InventoryLocations_LocationId",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropForeignKey(
                name: "FK_StockMovements_InventoryLocations_LocationId",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropTable(
                name: "InternalTransferLines",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "MaterialBranchStocks",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "InternalTransfers",
                schema: "costing");

            migrationBuilder.DropIndex(
                name: "IX_StockMovements_LocationId",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropIndex(
                name: "IX_StockMovements_RawMaterialId_LocationId",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropIndex(
                name: "IX_StockCounts_LocationId",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseInvoices_LocationId",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropIndex(
                name: "IX_ProductionOrders_LocationId",
                schema: "costing",
                table: "ProductionOrders");

            migrationBuilder.DropColumn(
                name: "LocationId",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropColumn(
                name: "LocationId",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "LocationId",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropColumn(
                name: "LocationId",
                schema: "costing",
                table: "ProductionOrders");

            migrationBuilder.DropColumn(
                name: "StationIds",
                schema: "costing",
                table: "InventoryLocations");
        }
    }
}
