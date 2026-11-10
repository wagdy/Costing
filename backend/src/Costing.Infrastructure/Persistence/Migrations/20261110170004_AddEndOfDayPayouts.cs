using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEndOfDayPayouts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "OpeningFloat",
                schema: "costing",
                table: "EndOfDayReports",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "EndOfDayPayouts",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ReportId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SupplierId = table.Column<Guid>(type: "uuid", nullable: true),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Note = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ReceiptFileName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ReceiptContentType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ReceiptBytes = table.Column<int>(type: "integer", nullable: false),
                    AddedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VoucheredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EndOfDayPayouts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EndOfDayPayouts_EndOfDayReports_ReportId",
                        column: x => x.ReportId,
                        principalSchema: "costing",
                        principalTable: "EndOfDayReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EndOfDayPayouts_Staff_EmployeeId",
                        column: x => x.EmployeeId,
                        principalSchema: "costing",
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EndOfDayPayouts_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalSchema: "costing",
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayPayouts_EmployeeId",
                schema: "costing",
                table: "EndOfDayPayouts",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayPayouts_ReportId",
                schema: "costing",
                table: "EndOfDayPayouts",
                column: "ReportId");

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayPayouts_SupplierId",
                schema: "costing",
                table: "EndOfDayPayouts",
                column: "SupplierId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EndOfDayPayouts",
                schema: "costing");

            migrationBuilder.DropColumn(
                name: "OpeningFloat",
                schema: "costing",
                table: "EndOfDayReports");
        }
    }
}
