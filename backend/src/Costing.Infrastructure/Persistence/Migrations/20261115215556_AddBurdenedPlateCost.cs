using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBurdenedPlateCost : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ComplexityWeight",
                schema: "costing",
                table: "Recipes",
                type: "numeric(6,2)",
                precision: 6,
                scale: 2,
                nullable: false,
                defaultValue: 1m);

            migrationBuilder.AddColumn<decimal>(
                name: "PrepTimeMinutes",
                schema: "costing",
                table: "Recipes",
                type: "numeric(6,2)",
                precision: 6,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ComplexityWeight",
                schema: "costing",
                table: "PrepRecipes",
                type: "numeric(6,2)",
                precision: 6,
                scale: 2,
                nullable: false,
                defaultValue: 1m);

            migrationBuilder.AddColumn<decimal>(
                name: "PrepTimeMinutes",
                schema: "costing",
                table: "PrepRecipes",
                type: "numeric(6,2)",
                precision: 6,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DefaultOverheadAllocationMethod",
                schema: "costing",
                table: "CostingSettings",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "ActivityBasedPrepTime");

            migrationBuilder.AddColumn<decimal>(
                name: "FallbackMonthlyLaborCost",
                schema: "costing",
                table: "CostingSettings",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "FallbackMonthlyOverheadCost",
                schema: "costing",
                table: "CostingSettings",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "TargetNetMarginPercent",
                schema: "costing",
                table: "CostingSettings",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 15m);

            // What was written before starts at the kitchen's ordinary 10 minutes, as a new one does.
            migrationBuilder.Sql("""UPDATE costing."Recipes" SET "PrepTimeMinutes" = 10;""");
            migrationBuilder.Sql("""UPDATE costing."PrepRecipes" SET "PrepTimeMinutes" = 10;""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ComplexityWeight",
                schema: "costing",
                table: "Recipes");

            migrationBuilder.DropColumn(
                name: "PrepTimeMinutes",
                schema: "costing",
                table: "Recipes");

            migrationBuilder.DropColumn(
                name: "ComplexityWeight",
                schema: "costing",
                table: "PrepRecipes");

            migrationBuilder.DropColumn(
                name: "PrepTimeMinutes",
                schema: "costing",
                table: "PrepRecipes");

            migrationBuilder.DropColumn(
                name: "DefaultOverheadAllocationMethod",
                schema: "costing",
                table: "CostingSettings");

            migrationBuilder.DropColumn(
                name: "FallbackMonthlyLaborCost",
                schema: "costing",
                table: "CostingSettings");

            migrationBuilder.DropColumn(
                name: "FallbackMonthlyOverheadCost",
                schema: "costing",
                table: "CostingSettings");

            migrationBuilder.DropColumn(
                name: "TargetNetMarginPercent",
                schema: "costing",
                table: "CostingSettings");
        }
    }
}
