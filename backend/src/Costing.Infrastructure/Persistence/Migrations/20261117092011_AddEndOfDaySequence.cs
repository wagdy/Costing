using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEndOfDaySequence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "BooksLockedUntil",
                schema: "costing",
                table: "FinancialSettings",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReopenReason",
                schema: "costing",
                table: "EndOfDayReports",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "VoucherId",
                schema: "costing",
                table: "EndOfDayPayouts",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            // Every payment kept so far was made its safe entry under its own id.
            migrationBuilder.Sql("UPDATE costing.\"EndOfDayPayouts\" SET \"VoucherId\" = \"Id\";");

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayPayouts_VoucherId",
                schema: "costing",
                table: "EndOfDayPayouts",
                column: "VoucherId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_EndOfDayPayouts_VoucherId",
                schema: "costing",
                table: "EndOfDayPayouts");

            migrationBuilder.DropColumn(
                name: "BooksLockedUntil",
                schema: "costing",
                table: "FinancialSettings");

            migrationBuilder.DropColumn(
                name: "ReopenReason",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "VoucherId",
                schema: "costing",
                table: "EndOfDayPayouts");
        }
    }
}
