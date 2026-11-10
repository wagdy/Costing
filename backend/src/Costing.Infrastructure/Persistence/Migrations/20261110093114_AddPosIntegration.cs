using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPosIntegration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PosDays",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    SaleId = table.Column<Guid>(type: "uuid", nullable: true),
                    TakingsId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PosDays", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PosLinks",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    KeyHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    KeyHint = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    KeyCreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    KeyCreatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PosLinks", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PosSyncLogs",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Endpoint = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Outcome = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Message = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    ZReportId = table.Column<Guid>(type: "uuid", nullable: true),
                    BusinessDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Detail = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PosSyncLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PosZReports",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BusinessDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ShiftNumber = table.Column<int>(type: "integer", nullable: true),
                    Source = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    PayloadHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Payload = table.Column<string>(type: "text", nullable: false),
                    ReceivedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PosZReports", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PosDays_Date",
                schema: "costing",
                table: "PosDays",
                column: "Date",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PosSyncLogs_AtUtc",
                schema: "costing",
                table: "PosSyncLogs",
                column: "AtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_PosZReports_BusinessDate",
                schema: "costing",
                table: "PosZReports",
                column: "BusinessDate");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PosDays",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PosLinks",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PosSyncLogs",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "PosZReports",
                schema: "costing");
        }
    }
}
