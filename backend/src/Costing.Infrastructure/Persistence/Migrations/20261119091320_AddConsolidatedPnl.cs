using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddConsolidatedPnl : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_MonthlyExpenses",
                schema: "costing",
                table: "MonthlyExpenses");

            migrationBuilder.AddColumn<decimal>(
                name: "CompanyUnitCost",
                schema: "costing",
                table: "StockMovements",
                type: "numeric(18,6)",
                precision: 18,
                scale: 6,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                schema: "costing",
                table: "MonthlyExpenses",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("b2a40000-0000-4000-8000-000000000001"));

            migrationBuilder.AddColumn<decimal>(
                name: "CompanyAverageCost",
                schema: "costing",
                table: "MaterialBranchStocks",
                type: "numeric(18,6)",
                precision: 18,
                scale: 6,
                nullable: true);

            migrationBuilder.AddPrimaryKey(
                name: "PK_MonthlyExpenses",
                schema: "costing",
                table: "MonthlyExpenses",
                columns: new[] { "Year", "Month", "BranchId" });

            migrationBuilder.CreateIndex(
                name: "IX_MonthlyExpenses_BranchId",
                schema: "costing",
                table: "MonthlyExpenses",
                column: "BranchId");

            migrationBuilder.AddForeignKey(
                name: "FK_MonthlyExpenses_Branches_BranchId",
                schema: "costing",
                table: "MonthlyExpenses",
                column: "BranchId",
                principalSchema: "costing",
                principalTable: "Branches",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MonthlyExpenses_Branches_BranchId",
                schema: "costing",
                table: "MonthlyExpenses");

            migrationBuilder.DropPrimaryKey(
                name: "PK_MonthlyExpenses",
                schema: "costing",
                table: "MonthlyExpenses");

            // One month a row again: only the first branch's are kept.
            migrationBuilder.Sql(
                "DELETE FROM costing.\"MonthlyExpenses\" WHERE \"BranchId\" <> 'b2a40000-0000-4000-8000-000000000001';");

            migrationBuilder.DropIndex(
                name: "IX_MonthlyExpenses_BranchId",
                schema: "costing",
                table: "MonthlyExpenses");

            migrationBuilder.DropColumn(
                name: "CompanyUnitCost",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropColumn(
                name: "BranchId",
                schema: "costing",
                table: "MonthlyExpenses");

            migrationBuilder.DropColumn(
                name: "CompanyAverageCost",
                schema: "costing",
                table: "MaterialBranchStocks");

            migrationBuilder.AddPrimaryKey(
                name: "PK_MonthlyExpenses",
                schema: "costing",
                table: "MonthlyExpenses",
                columns: new[] { "Year", "Month" });
        }
    }
}
