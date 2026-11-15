using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBlindAndSpotCounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Review",
                schema: "costing",
                table: "StockCounts",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "Counting");

            migrationBuilder.AddColumn<string>(
                name: "ReviewNote",
                schema: "costing",
                table: "StockCounts",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReviewedAtUtc",
                schema: "costing",
                table: "StockCounts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReviewedBy",
                schema: "costing",
                table: "StockCounts",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Scope",
                schema: "costing",
                table: "StockCounts",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "Full");

            migrationBuilder.AddColumn<string>(
                name: "ScopeLabel",
                schema: "costing",
                table: "StockCounts",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<Guid[]>(
                name: "ScopeMaterialIds",
                schema: "costing",
                table: "StockCounts",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.AddColumn<DateTime>(
                name: "SubmittedAtUtc",
                schema: "costing",
                table: "StockCounts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SubmittedBy",
                schema: "costing",
                table: "StockCounts",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Note",
                schema: "costing",
                table: "StockCountLines",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "RecountRequested",
                schema: "costing",
                table: "StockCountLines",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsSpotCheckItem",
                schema: "costing",
                table: "RawMaterials",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Review",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "ReviewNote",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "ReviewedAtUtc",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "ReviewedBy",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "Scope",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "ScopeLabel",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "ScopeMaterialIds",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "SubmittedAtUtc",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "SubmittedBy",
                schema: "costing",
                table: "StockCounts");

            migrationBuilder.DropColumn(
                name: "Note",
                schema: "costing",
                table: "StockCountLines");

            migrationBuilder.DropColumn(
                name: "RecountRequested",
                schema: "costing",
                table: "StockCountLines");

            migrationBuilder.DropColumn(
                name: "IsSpotCheckItem",
                schema: "costing",
                table: "RawMaterials");
        }
    }
}
