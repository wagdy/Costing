using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPurchaseOrders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "ClosesPurchaseOrder",
                schema: "costing",
                table: "PurchaseInvoices",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "PurchaseOrderId",
                schema: "costing",
                table: "PurchaseInvoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PurchaseOrderId",
                schema: "costing",
                table: "EndOfDayInvoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PurchaseOrders",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    PoNumber = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SupplierId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ExpectedDeliveryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    PaymentTerms = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CreatedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ApprovedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    ApprovedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ApprovedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelledAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelledBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ClosedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClosedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ClosedByInvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseOrders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PurchaseOrders_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalSchema: "costing",
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PurchaseOrderLines",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PurchaseOrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    MaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    OrderedPurchaseQty = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    ReceivedPurchaseQty = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    ExpectedUnitCost = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                    LineNotes = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseOrderLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PurchaseOrderLines_PurchaseOrders_PurchaseOrderId",
                        column: x => x.PurchaseOrderId,
                        principalSchema: "costing",
                        principalTable: "PurchaseOrders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PurchaseOrderLines_RawMaterials_MaterialId",
                        column: x => x.MaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseInvoices_PurchaseOrderId",
                schema: "costing",
                table: "PurchaseInvoices",
                column: "PurchaseOrderId",
                filter: "\"PurchaseOrderId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayInvoices_PurchaseOrderId",
                schema: "costing",
                table: "EndOfDayInvoices",
                column: "PurchaseOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseOrderLines_MaterialId",
                schema: "costing",
                table: "PurchaseOrderLines",
                column: "MaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseOrderLines_PurchaseOrderId_MaterialId",
                schema: "costing",
                table: "PurchaseOrderLines",
                columns: new[] { "PurchaseOrderId", "MaterialId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseOrders_PoNumber",
                schema: "costing",
                table: "PurchaseOrders",
                column: "PoNumber",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseOrders_Status_SupplierId",
                schema: "costing",
                table: "PurchaseOrders",
                columns: new[] { "Status", "SupplierId" });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseOrders_SupplierId",
                schema: "costing",
                table: "PurchaseOrders",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseOrders_Year_Sequence",
                schema: "costing",
                table: "PurchaseOrders",
                columns: new[] { "Year", "Sequence" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_EndOfDayInvoices_PurchaseOrders_PurchaseOrderId",
                schema: "costing",
                table: "EndOfDayInvoices",
                column: "PurchaseOrderId",
                principalSchema: "costing",
                principalTable: "PurchaseOrders",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseInvoices_PurchaseOrders_PurchaseOrderId",
                schema: "costing",
                table: "PurchaseInvoices",
                column: "PurchaseOrderId",
                principalSchema: "costing",
                principalTable: "PurchaseOrders",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_EndOfDayInvoices_PurchaseOrders_PurchaseOrderId",
                schema: "costing",
                table: "EndOfDayInvoices");

            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseInvoices_PurchaseOrders_PurchaseOrderId",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropTable(
                name: "PurchaseOrderLines",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PurchaseOrders",
                schema: "costing");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseInvoices_PurchaseOrderId",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropIndex(
                name: "IX_EndOfDayInvoices_PurchaseOrderId",
                schema: "costing",
                table: "EndOfDayInvoices");

            migrationBuilder.DropColumn(
                name: "ClosesPurchaseOrder",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropColumn(
                name: "PurchaseOrderId",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropColumn(
                name: "PurchaseOrderId",
                schema: "costing",
                table: "EndOfDayInvoices");
        }
    }
}
