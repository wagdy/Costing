using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCombosAndDiscounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DiscountReasons",
                schema: "costing",
                table: "SalesReceipts",
                type: "jsonb",
                nullable: false,
                defaultValueSql: "'[]'::jsonb");

            migrationBuilder.AddColumn<string>(
                name: "DiscountReasons",
                schema: "costing",
                table: "SafeTransactions",
                type: "jsonb",
                nullable: false,
                defaultValueSql: "'[]'::jsonb");

            migrationBuilder.AddColumn<decimal>(
                name: "DiscountsAmount",
                schema: "costing",
                table: "SafeTransactions",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "DiscountReasons",
                schema: "costing",
                table: "PosDays",
                type: "jsonb",
                nullable: false,
                defaultValueSql: "'[]'::jsonb");

            migrationBuilder.AddColumn<decimal>(
                name: "DiscountsAmount",
                schema: "costing",
                table: "PosDays",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<Guid>(
                name: "ComboOfferId",
                schema: "costing",
                table: "MenuItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DiscountReasons",
                schema: "costing",
                table: "EndOfDayReports",
                type: "jsonb",
                nullable: false,
                defaultValueSql: "'[]'::jsonb");

            migrationBuilder.AddColumn<decimal>(
                name: "DiscountsAmount",
                schema: "costing",
                table: "EndOfDayReports",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ComboOffers",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    NameAr = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SellingPrice = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeletedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ComboOffers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ComboOfferItems",
                schema: "costing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ComboOfferId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ComboOfferItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ComboOfferItems_ComboOffers_ComboOfferId",
                        column: x => x.ComboOfferId,
                        principalSchema: "costing",
                        principalTable: "ComboOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ComboOfferItems_Recipes_RecipeId",
                        column: x => x.RecipeId,
                        principalSchema: "costing",
                        principalTable: "Recipes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MenuItems_ComboOfferId",
                schema: "costing",
                table: "MenuItems",
                column: "ComboOfferId",
                unique: true,
                filter: "\"ComboOfferId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ComboOfferItems_ComboOfferId_RecipeId",
                schema: "costing",
                table: "ComboOfferItems",
                columns: new[] { "ComboOfferId", "RecipeId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ComboOfferItems_RecipeId",
                schema: "costing",
                table: "ComboOfferItems",
                column: "RecipeId");

            migrationBuilder.CreateIndex(
                name: "IX_ComboOffers_Code",
                schema: "costing",
                table: "ComboOffers",
                column: "Code",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_MenuItems_ComboOffers_ComboOfferId",
                schema: "costing",
                table: "MenuItems",
                column: "ComboOfferId",
                principalSchema: "costing",
                principalTable: "ComboOffers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MenuItems_ComboOffers_ComboOfferId",
                schema: "costing",
                table: "MenuItems");

            migrationBuilder.DropTable(
                name: "ComboOfferItems",
                schema: "costing");

            migrationBuilder.DropTable(
                name: "ComboOffers",
                schema: "costing");

            migrationBuilder.DropIndex(
                name: "IX_MenuItems_ComboOfferId",
                schema: "costing",
                table: "MenuItems");

            migrationBuilder.DropColumn(
                name: "DiscountReasons",
                schema: "costing",
                table: "SalesReceipts");

            migrationBuilder.DropColumn(
                name: "DiscountReasons",
                schema: "costing",
                table: "SafeTransactions");

            migrationBuilder.DropColumn(
                name: "DiscountsAmount",
                schema: "costing",
                table: "SafeTransactions");

            migrationBuilder.DropColumn(
                name: "DiscountReasons",
                schema: "costing",
                table: "PosDays");

            migrationBuilder.DropColumn(
                name: "DiscountsAmount",
                schema: "costing",
                table: "PosDays");

            migrationBuilder.DropColumn(
                name: "ComboOfferId",
                schema: "costing",
                table: "MenuItems");

            migrationBuilder.DropColumn(
                name: "DiscountReasons",
                schema: "costing",
                table: "EndOfDayReports");

            migrationBuilder.DropColumn(
                name: "DiscountsAmount",
                schema: "costing",
                table: "EndOfDayReports");
        }
    }
}
