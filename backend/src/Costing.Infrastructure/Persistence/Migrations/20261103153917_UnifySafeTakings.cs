using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Costing.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UnifySafeTakings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Takings entered so far had the tax inside their cash and card, and only the cash in the
            // safe. Now the cash and card are the sales before tax, the tax is on top, and all of it
            // is in the safe: the tax comes off the cash and card in proportion (to the piastre, the
            // card taking the rest), so the three still add up to what was collected and the net sales
            // stay as they were; and the card is added to what reached the safe. A void's reversal
            // is the same with the signs turned, so the two still net out.
            migrationBuilder.Sql("""
                UPDATE costing."SafeTransactions" SET
                    "GrossAmount" = COALESCE("GrossAmount", "Amount") - (CASE WHEN COALESCE("GrossAmount", "Amount") + "CardAmount" <> 0
                        THEN ROUND("TaxAmount" * COALESCE("GrossAmount", "Amount") / (COALESCE("GrossAmount", "Amount") + "CardAmount"), 2) ELSE 0 END),
                    "CardAmount" = "CardAmount" - ("TaxAmount" - (CASE WHEN COALESCE("GrossAmount", "Amount") + "CardAmount" <> 0
                        THEN ROUND("TaxAmount" * COALESCE("GrossAmount", "Amount") / (COALESCE("GrossAmount", "Amount") + "CardAmount"), 2) ELSE 0 END)),
                    "Amount" = "Amount" + "CardAmount"
                WHERE "Kind" = 'RevenueTransfer';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Back to the tax inside the cash and card, shared by their amounts now (the piastre may
            // fall the other way), and the card out of the safe. Tax payments are kept: the older
            // code cannot read them, so void or re-enter them by hand before going back.
            migrationBuilder.Sql("""
                UPDATE costing."SafeTransactions" SET
                    "GrossAmount" = "GrossAmount" + (CASE WHEN "GrossAmount" + "CardAmount" <> 0
                        THEN ROUND("TaxAmount" * "GrossAmount" / ("GrossAmount" + "CardAmount"), 2) ELSE "TaxAmount" END),
                    "CardAmount" = "CardAmount" + "TaxAmount" - (CASE WHEN "GrossAmount" + "CardAmount" <> 0
                        THEN ROUND("TaxAmount" * "GrossAmount" / ("GrossAmount" + "CardAmount"), 2) ELSE "TaxAmount" END),
                    "Amount" = "Amount" - ("CardAmount" + "TaxAmount" - (CASE WHEN "GrossAmount" + "CardAmount" <> 0
                        THEN ROUND("TaxAmount" * "GrossAmount" / ("GrossAmount" + "CardAmount"), 2) ELSE "TaxAmount" END))
                WHERE "Kind" = 'RevenueTransfer' AND "GrossAmount" IS NOT NULL;
                """);
        }
    }
}
