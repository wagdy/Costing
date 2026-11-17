using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEndOfDayClosedDaysAndAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Notes",
                schema: "costing",
                table: "EndOfDayReports",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AuditTrail",
                schema: "costing",
                table: "EndOfDayReports",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ClosedDayReason",
                schema: "costing",
                table: "EndOfDayReports",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsClosedDay",
                schema: "costing",
                table: "EndOfDayReports",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AlterColumn<string>(
                name: "Note",
                schema: "costing",
                table: "EndOfDayInvoices",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AuditTrail",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "ClosedDayReason",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "IsClosedDay",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.AlterColumn<string>(
                name: "Notes",
                schema: "costing",
                table: "EndOfDayReports",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(2000)",
                oldMaxLength: 2000,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Note",
                schema: "costing",
                table: "EndOfDayInvoices",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000,
                oldNullable: true);
        }
    }
}
