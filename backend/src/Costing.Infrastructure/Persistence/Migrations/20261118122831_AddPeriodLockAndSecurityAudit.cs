using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPeriodLockAndSecurityAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "BooksLockedUntilDate",
                schema: "costing",
                table: "CompanySettings",
                type: "date",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "SecurityAuditLogs",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    PreviousValue = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    NewValue = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    By = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ByUserId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SecurityAuditLogs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SecurityAuditLogs_OccurredAtUtc",
                schema: "costing",
                table: "SecurityAuditLogs",
                column: "OccurredAtUtc");

            // The lock set before, on Financials, carried over to the company's, and written to the
            // audit log as where its history starts.
            migrationBuilder.Sql("""
                UPDATE costing."CompanySettings" c
                SET "BooksLockedUntilDate" = f."BooksLockedUntil"
                FROM costing."FinancialSettings" f
                WHERE f."BooksLockedUntil" IS NOT NULL;

                INSERT INTO costing."SecurityAuditLogs" ("Id", "OccurredAtUtc", "Action", "Description", "PreviousValue", "NewValue", "Reason", "By", "ByUserId")
                SELECT gen_random_uuid(), now() AT TIME ZONE 'utc', 'PeriodLocked',
                       'PeriodLocked: ' || to_char(c."BooksLockedUntilDate", 'DD-Mon-YYYY') || ' by System (carried over from the earlier books lock)',
                       NULL, to_char(c."BooksLockedUntilDate", 'YYYY-MM-DD'), NULL, 'System', NULL
                FROM costing."CompanySettings" c
                WHERE c."BooksLockedUntilDate" IS NOT NULL;
                """);

            migrationBuilder.DropColumn(
                name: "BooksLockedUntil",
                schema: "costing",
                table: "FinancialSettings");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "BooksLockedUntil",
                schema: "costing",
                table: "FinancialSettings",
                type: "date",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE costing."FinancialSettings" f
                SET "BooksLockedUntil" = c."BooksLockedUntilDate"
                FROM costing."CompanySettings" c;
                """);

            migrationBuilder.DropTable(
                name: "SecurityAuditLogs",
                schema: "costing");

            migrationBuilder.DropColumn(
                name: "BooksLockedUntilDate",
                schema: "costing",
                table: "CompanySettings");
        }
    }
}
