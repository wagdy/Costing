using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddInterBranchHub : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "InterBranchRequisitions",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestingBranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SupplyingBranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestDate = table.Column<DateOnly>(type: "date", nullable: false),
                    RequestedDeliveryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedByUserId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CancelledAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelledBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InterBranchRequisitions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InterBranchRequisitions_Branches_RequestingBranchId",
                        column: x => x.RequestingBranchId,
                        principalSchema: "costing",
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InterBranchRequisitions_Branches_SupplyingBranchId",
                        column: x => x.SupplyingBranchId,
                        principalSchema: "costing",
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InterBranchRequisitionLines",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InterBranchRequisitionId = table.Column<Guid>(type: "uuid", nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    DispatchedQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    ReceivedQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Notes = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InterBranchRequisitionLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InterBranchRequisitionLines_InterBranchRequisitions_InterBr~",
                        column: x => x.InterBranchRequisitionId,
                        principalSchema: "costing",
                        principalTable: "InterBranchRequisitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_InterBranchRequisitionLines_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InternalSalesInvoices",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SupplyingBranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    RequisitionId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReceivingBranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    FromLocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    DispatchDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Pricing = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    MarkupPercent = table.Column<decimal>(type: "numeric(9,4)", precision: 9, scale: 4, nullable: true),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedByUserId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReceivedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    InternalPurchaseInvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    IsInterCompany = table.Column<bool>(type: "boolean", nullable: false),
                    TotalTransferRevenue = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalInternalCogs = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    InternalMargin = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InternalSalesInvoices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InternalSalesInvoices_Branches_ReceivingBranchId",
                        column: x => x.ReceivingBranchId,
                        principalSchema: "costing",
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InternalSalesInvoices_Branches_SupplyingBranchId",
                        column: x => x.SupplyingBranchId,
                        principalSchema: "costing",
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InternalSalesInvoices_InterBranchRequisitions_RequisitionId",
                        column: x => x.RequisitionId,
                        principalSchema: "costing",
                        principalTable: "InterBranchRequisitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InternalSalesInvoices_InventoryLocations_FromLocationId",
                        column: x => x.FromLocationId,
                        principalSchema: "costing",
                        principalTable: "InventoryLocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InternalPurchaseInvoices",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ReceivingBranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    InternalSalesInvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequisitionId = table.Column<Guid>(type: "uuid", nullable: true),
                    SupplyingBranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    ToLocationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReceiptDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedByUserId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    IsInterCompany = table.Column<bool>(type: "boolean", nullable: false),
                    TotalBilled = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalReceivedValue = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalTransitLoss = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InternalPurchaseInvoices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InternalPurchaseInvoices_Branches_ReceivingBranchId",
                        column: x => x.ReceivingBranchId,
                        principalSchema: "costing",
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InternalPurchaseInvoices_Branches_SupplyingBranchId",
                        column: x => x.SupplyingBranchId,
                        principalSchema: "costing",
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InternalPurchaseInvoices_InterBranchRequisitions_Requisitio~",
                        column: x => x.RequisitionId,
                        principalSchema: "costing",
                        principalTable: "InterBranchRequisitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InternalPurchaseInvoices_InternalSalesInvoices_InternalSale~",
                        column: x => x.InternalSalesInvoiceId,
                        principalSchema: "costing",
                        principalTable: "InternalSalesInvoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InternalPurchaseInvoices_InventoryLocations_ToLocationId",
                        column: x => x.ToLocationId,
                        principalSchema: "costing",
                        principalTable: "InventoryLocations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InternalSalesInvoiceLines",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InternalSalesInvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    UnitCost = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    TransferUnitPrice = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    LineRevenue = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    LineCogs = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    ReceivedQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InternalSalesInvoiceLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InternalSalesInvoiceLines_InternalSalesInvoices_InternalSal~",
                        column: x => x.InternalSalesInvoiceId,
                        principalSchema: "costing",
                        principalTable: "InternalSalesInvoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_InternalSalesInvoiceLines_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InternalPurchaseInvoiceLines",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InternalPurchaseInvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    RawMaterialId = table.Column<Guid>(type: "uuid", nullable: false),
                    DispatchedQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    ReceivedQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    ShortQuantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    TransferUnitPrice = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    LineTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    ReceivedValue = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TransitLoss = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InternalPurchaseInvoiceLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InternalPurchaseInvoiceLines_InternalPurchaseInvoices_Inter~",
                        column: x => x.InternalPurchaseInvoiceId,
                        principalSchema: "costing",
                        principalTable: "InternalPurchaseInvoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_InternalPurchaseInvoiceLines_RawMaterials_RawMaterialId",
                        column: x => x.RawMaterialId,
                        principalSchema: "costing",
                        principalTable: "RawMaterials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InterBranchRequisitionLines_InterBranchRequisitionId",
                schema: "costing",
                table: "InterBranchRequisitionLines",
                column: "InterBranchRequisitionId");

            migrationBuilder.CreateIndex(
                name: "IX_InterBranchRequisitionLines_RawMaterialId",
                schema: "costing",
                table: "InterBranchRequisitionLines",
                column: "RawMaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_InterBranchRequisitions_Number",
                schema: "costing",
                table: "InterBranchRequisitions",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InterBranchRequisitions_RequestingBranchId_RequestDate",
                schema: "costing",
                table: "InterBranchRequisitions",
                columns: new[] { "RequestingBranchId", "RequestDate" });

            migrationBuilder.CreateIndex(
                name: "IX_InterBranchRequisitions_SupplyingBranchId_RequestDate",
                schema: "costing",
                table: "InterBranchRequisitions",
                columns: new[] { "SupplyingBranchId", "RequestDate" });

            migrationBuilder.CreateIndex(
                name: "IX_InternalPurchaseInvoiceLines_InternalPurchaseInvoiceId",
                schema: "costing",
                table: "InternalPurchaseInvoiceLines",
                column: "InternalPurchaseInvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalPurchaseInvoiceLines_RawMaterialId",
                schema: "costing",
                table: "InternalPurchaseInvoiceLines",
                column: "RawMaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalPurchaseInvoices_InternalSalesInvoiceId",
                schema: "costing",
                table: "InternalPurchaseInvoices",
                column: "InternalSalesInvoiceId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InternalPurchaseInvoices_Number",
                schema: "costing",
                table: "InternalPurchaseInvoices",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InternalPurchaseInvoices_ReceivingBranchId_ReceiptDate",
                schema: "costing",
                table: "InternalPurchaseInvoices",
                columns: new[] { "ReceivingBranchId", "ReceiptDate" });

            migrationBuilder.CreateIndex(
                name: "IX_InternalPurchaseInvoices_RequisitionId",
                schema: "costing",
                table: "InternalPurchaseInvoices",
                column: "RequisitionId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalPurchaseInvoices_SupplyingBranchId_ReceiptDate",
                schema: "costing",
                table: "InternalPurchaseInvoices",
                columns: new[] { "SupplyingBranchId", "ReceiptDate" });

            migrationBuilder.CreateIndex(
                name: "IX_InternalPurchaseInvoices_ToLocationId",
                schema: "costing",
                table: "InternalPurchaseInvoices",
                column: "ToLocationId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalSalesInvoiceLines_InternalSalesInvoiceId",
                schema: "costing",
                table: "InternalSalesInvoiceLines",
                column: "InternalSalesInvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalSalesInvoiceLines_RawMaterialId",
                schema: "costing",
                table: "InternalSalesInvoiceLines",
                column: "RawMaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalSalesInvoices_FromLocationId",
                schema: "costing",
                table: "InternalSalesInvoices",
                column: "FromLocationId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalSalesInvoices_Number",
                schema: "costing",
                table: "InternalSalesInvoices",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InternalSalesInvoices_ReceivingBranchId_DispatchDate",
                schema: "costing",
                table: "InternalSalesInvoices",
                columns: new[] { "ReceivingBranchId", "DispatchDate" });

            migrationBuilder.CreateIndex(
                name: "IX_InternalSalesInvoices_RequisitionId",
                schema: "costing",
                table: "InternalSalesInvoices",
                column: "RequisitionId");

            migrationBuilder.CreateIndex(
                name: "IX_InternalSalesInvoices_SupplyingBranchId_DispatchDate",
                schema: "costing",
                table: "InternalSalesInvoices",
                columns: new[] { "SupplyingBranchId", "DispatchDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InterBranchRequisitionLines",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "InternalPurchaseInvoiceLines",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "InternalSalesInvoiceLines",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "InternalPurchaseInvoices",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "InternalSalesInvoices",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "InterBranchRequisitions",
                schema: "costing");
        }
    }
}
