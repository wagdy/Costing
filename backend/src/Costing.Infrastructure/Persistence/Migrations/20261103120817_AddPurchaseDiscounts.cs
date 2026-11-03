using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPurchaseDiscounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "Discount",
                schema: "costing",
                table: "PurchaseInvoices",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "Discount",
                schema: "costing",
                table: "PurchaseInvoiceLines",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "DiscountShare",
                schema: "costing",
                table: "PurchaseInvoiceLines",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "LineTotal",
                schema: "costing",
                table: "PurchaseInvoiceLines",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            // Every line so far was entered without a discount: as written is what it cost.
            migrationBuilder.Sql("UPDATE costing.\"PurchaseInvoiceLines\" SET \"LineTotal\" = \"Cost\";");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Discount",
                schema: "costing",
                table: "PurchaseInvoices");

            migrationBuilder.DropColumn(
                name: "Discount",
                schema: "costing",
                table: "PurchaseInvoiceLines");

            migrationBuilder.DropColumn(
                name: "DiscountShare",
                schema: "costing",
                table: "PurchaseInvoiceLines");

            migrationBuilder.DropColumn(
                name: "LineTotal",
                schema: "costing",
                table: "PurchaseInvoiceLines");
        }
    }
}
