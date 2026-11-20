using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPosSyncedEndOfDay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "CashTaxAmount",
                schema: "costing",
                table: "EndOfDayReports",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PosShifts",
                schema: "costing",
                table: "EndOfDayReports",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "SalesFromPos",
                schema: "costing",
                table: "EndOfDayReports",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "SalesOverriddenAtUtc",
                schema: "costing",
                table: "EndOfDayReports",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SalesOverriddenBy",
                schema: "costing",
                table: "EndOfDayReports",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SalesOverrideNote",
                schema: "costing",
                table: "EndOfDayReports",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "FromPos",
                schema: "costing",
                table: "EndOfDayPayouts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "PosShiftNumber",
                schema: "costing",
                table: "EndOfDayPayouts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "FromPos",
                schema: "costing",
                table: "EndOfDayInvoices",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "PosShiftNumber",
                schema: "costing",
                table: "EndOfDayInvoices",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CashTaxAmount",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "PosShifts",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "SalesFromPos",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "SalesOverriddenAtUtc",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "SalesOverriddenBy",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "SalesOverrideNote",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "FromPos",
                schema: "costing",
                table: "EndOfDayPayouts");

            migrationBuilder.DropColumn(
                name: "PosShiftNumber",
                schema: "costing",
                table: "EndOfDayPayouts");

            migrationBuilder.DropColumn(
                name: "FromPos",
                schema: "costing",
                table: "EndOfDayInvoices");

            migrationBuilder.DropColumn(
                name: "PosShiftNumber",
                schema: "costing",
                table: "EndOfDayInvoices");
        }
    }
}
