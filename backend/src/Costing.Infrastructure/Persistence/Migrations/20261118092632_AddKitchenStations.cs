using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddKitchenStations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ResponsibleStationId",
                schema: "costing",
                table: "StockMovements",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "KitchenStationId",
                schema: "costing",
                table: "Recipes",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "KitchenStationId",
                schema: "costing",
                table: "RawMaterials",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "KitchenStations",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    TargetVarianceTolerancePercent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KitchenStations", x => x.Id);
                });

            // The stations a kitchen starts with, once: each changed or taken away by a manager after.
            migrationBuilder.InsertData(
                schema: "costing",
                table: "KitchenStations",
                columns: ["Id", "Name", "NameAr", "Code", "DisplayOrder", "TargetVarianceTolerancePercent", "IsActive"],
                values: new object[,]
                {
                    { new Guid("5a1f0000-0000-4000-8000-000000000001"), "Grill", "المشويات", "GRILL", 1, null!, true },
                    { new Guid("5a1f0000-0000-4000-8000-000000000002"), "Pizza & Bakery", "البيتزا والمخبوزات", "PIZZA", 2, null!, true },
                    { new Guid("5a1f0000-0000-4000-8000-000000000003"), "Hot Kitchen", "المطبخ الساخن", "HOT", 3, null!, true },
                    { new Guid("5a1f0000-0000-4000-8000-000000000004"), "Cold & Salads", "المقبلات والسلطات", "COLD", 4, null!, true },
                    { new Guid("5a1f0000-0000-4000-8000-000000000005"), "Bar & Barista", "البار والباريستا", "BAR", 5, null!, true },
                    { new Guid("5a1f0000-0000-4000-8000-000000000006"), "Pastry & Desserts", "الحلويات", "PASTRY", 6, null!, true },
                    { new Guid("5a1f0000-0000-4000-8000-000000000007"), "Shared / General", "خامات مشتركة", "SHARED", 7, null!, true },
                });

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_ResponsibleStationId",
                schema: "costing",
                table: "StockMovements",
                column: "ResponsibleStationId");

            migrationBuilder.CreateIndex(
                name: "IX_Recipes_KitchenStationId",
                schema: "costing",
                table: "Recipes",
                column: "KitchenStationId");

            migrationBuilder.CreateIndex(
                name: "IX_RawMaterials_KitchenStationId",
                schema: "costing",
                table: "RawMaterials",
                column: "KitchenStationId");

            migrationBuilder.CreateIndex(
                name: "IX_KitchenStations_Code",
                schema: "costing",
                table: "KitchenStations",
                column: "Code",
                unique: true,
                filter: "\"Code\" IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_RawMaterials_KitchenStations_KitchenStationId",
                schema: "costing",
                table: "RawMaterials",
                column: "KitchenStationId",
                principalSchema: "costing",
                principalTable: "KitchenStations",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Recipes_KitchenStations_KitchenStationId",
                schema: "costing",
                table: "Recipes",
                column: "KitchenStationId",
                principalSchema: "costing",
                principalTable: "KitchenStations",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_StockMovements_KitchenStations_ResponsibleStationId",
                schema: "costing",
                table: "StockMovements",
                column: "ResponsibleStationId",
                principalSchema: "costing",
                principalTable: "KitchenStations",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_RawMaterials_KitchenStations_KitchenStationId",
                schema: "costing",
                table: "RawMaterials");

            migrationBuilder.DropForeignKey(
                name: "FK_Recipes_KitchenStations_KitchenStationId",
                schema: "costing",
                table: "Recipes");

            migrationBuilder.DropForeignKey(
                name: "FK_StockMovements_KitchenStations_ResponsibleStationId",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropTable(
                name: "KitchenStations",
                schema: "costing");

            migrationBuilder.DropIndex(
                name: "IX_StockMovements_ResponsibleStationId",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropIndex(
                name: "IX_Recipes_KitchenStationId",
                schema: "costing",
                table: "Recipes");

            migrationBuilder.DropIndex(
                name: "IX_RawMaterials_KitchenStationId",
                schema: "costing",
                table: "RawMaterials");

            migrationBuilder.DropColumn(
                name: "ResponsibleStationId",
                schema: "costing",
                table: "StockMovements");

            migrationBuilder.DropColumn(
                name: "KitchenStationId",
                schema: "costing",
                table: "Recipes");

            migrationBuilder.DropColumn(
                name: "KitchenStationId",
                schema: "costing",
                table: "RawMaterials");
        }
    }
}
