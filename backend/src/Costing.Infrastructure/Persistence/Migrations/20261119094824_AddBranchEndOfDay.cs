using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBranchEndOfDay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PosDays_Date",
                schema: "costing",
                table: "PosDays");

            migrationBuilder.DropIndex(
                name: "IX_EndOfDayReports_Date",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "PosSyncLogs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "PosLinks",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "PosDays",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "EndOfDayReports",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            // Every call before was the first branch's till, but those refused for their key.
            migrationBuilder.Sql(
                "UPDATE costing.\"PosSyncLogs\" SET \"BranchId\" = 'b2a40000-0000-4000-8000-000000000001' WHERE \"Outcome\" <> 'Unauthorized';");

            migrationBuilder.CreateIndex(
                name: "IX_PosSyncLogs_BranchId",
                schema: "costing",
                table: "PosSyncLogs",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_PosLinks_BranchId",
                schema: "costing",
                table: "PosLinks",
                column: "BranchId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PosDays_BranchId_Date",
                schema: "costing",
                table: "PosDays",
                columns: new[] { "BranchId", "Date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayReports_BranchId_Date",
                schema: "costing",
                table: "EndOfDayReports",
                columns: new[] { "BranchId", "Date" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_EndOfDayReports_Branches_BranchId",
                schema: "costing",
                table: "EndOfDayReports",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PosDays_Branches_BranchId",
                schema: "costing",
                table: "PosDays",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PosLinks_Branches_BranchId",
                schema: "costing",
                table: "PosLinks",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        // Back to one a day: refused while another branch has a day of its own (nothing is deleted).
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_EndOfDayReports_Branches_BranchId",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropForeignKey(
                name: "FK_PosDays_Branches_BranchId",
                schema: "costing",
                table: "PosDays");

            migrationBuilder.DropForeignKey(
                name: "FK_PosLinks_Branches_BranchId",
                schema: "costing",
                table: "PosLinks");

            migrationBuilder.DropIndex(
                name: "IX_PosSyncLogs_BranchId",
                schema: "costing",
                table: "PosSyncLogs");

            migrationBuilder.DropIndex(
                name: "IX_PosLinks_BranchId",
                schema: "costing",
                table: "PosLinks");

            migrationBuilder.DropIndex(
                name: "IX_PosDays_BranchId_Date",
                schema: "costing",
                table: "PosDays");

            migrationBuilder.DropIndex(
                name: "IX_EndOfDayReports_BranchId_Date",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "PosSyncLogs");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "PosLinks");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "PosDays");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.CreateIndex(
                name: "IX_PosDays_Date",
                schema: "costing",
                table: "PosDays",
                column: "Date",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EndOfDayReports_Date",
                schema: "costing",
                table: "EndOfDayReports",
                column: "Date",
                unique: true);
        }
    }
}
