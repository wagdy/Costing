using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEndOfDay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EndOfDayPhotos",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Content = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EndOfDayPhotos", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EndOfDayReports",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CashAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    CardAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    TaxAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    VoidsAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    SalesPhotoFileName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SalesPhotoContentType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SalesPhotoBytes = table.Column<int>(type: "integer", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SubmittedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SubmittedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ReopenedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReopenedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EndOfDayReports", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EndOfDayInvoices",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ReportId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SupplierId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReportedTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Note = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    PhotoFileName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PhotoContentType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PhotoBytes = table.Column<int>(type: "integer", nullable: false),
                    AddedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PurchaseInvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    PostedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EndOfDayInvoices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EndOfDayInvoices_EndOfDayReports_ReportId",
                        column: x => x.ReportId,
                        principalSchema: "costing",
                        principalTable: "EndOfDayReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EndOfDayInvoices_PurchaseInvoices_PurchaseInvoiceId",
                        column: x => x.PurchaseInvoiceId,
                        principalSchema: "costing",
                        principalTable: "PurchaseInvoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EndOfDayInvoices_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalSchema: "costing",
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayInvoices_PurchaseInvoiceId",
                schema: "costing",
                table: "EndOfDayInvoices",
                column: "PurchaseInvoiceId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayInvoices_ReportId",
                schema: "costing",
                table: "EndOfDayInvoices",
                column: "ReportId");

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayInvoices_SupplierId",
                schema: "costing",
                table: "EndOfDayInvoices",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayReports_Date",
                schema: "costing",
                table: "EndOfDayReports",
                column: "Date",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EndOfDayInvoices",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "EndOfDayPhotos",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "EndOfDayReports",
                schema: "costing");
        }
    }
}
