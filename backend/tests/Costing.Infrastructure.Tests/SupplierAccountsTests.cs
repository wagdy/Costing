using ClosedXML.Excel;
using Costing.Application.Purchases;
using Costing.Application.RawMaterials;
using Costing.Application.Suppliers;
using Costing.Application.Treasury;
using Costing.Domain.Purchases;
using Costing.Domain.RawMaterials;
using Costing.Domain.Treasury;
using Costing.Infrastructure.Excel;
using Costing.Infrastructure.Reports;

namespace Costing.Infrastructure.Tests;

// Nile Farms gives 30 days to pay. Owed 500 from before the treasury (200 days ago); tomatoes on
// credit 130, 50 and 10 days ago (1,000, 2,000 and 3,000 for 10 kg each); 2 kg for 400 in cash today;
// 1,200 paid today: the 500 first, then 700 of the oldest invoice. Delta Farms sold 10 kg five days
// ago for 1,000 less 200 off the invoice: 80 a kg.
public class SupplierAccountsTests
{
    [Fact]
    public async Task What_is_owed_is_aged_from_when_it_fell_due_and_each_account_runs_its_balance()
    {
        await using var node = await TestSystem.StartAsync();
        var ct = TestContext.Current.CancellationToken;
        using var scope = node.Scope();
        var today = node.Service<IntelligenceService>(scope).Today;
        var tomatoes = (await node.Send(new CreateRawMaterialCommand("Tomatoes", UnitOfMeasure.Gram, PurchaseUnit: "kg", PurchaseUnitSize: 1000))).Id;
        var nile = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Nile Farms", PaymentTermsDays: 30))).Id;
        var delta = (await node.Send(new SaveSupplierCommand(Guid.NewGuid(), "Delta Farms"))).Id;
        Assert.Equal(30, (await node.Send(new SaveSupplierCommand(nile, "Nile Farms"))).PaymentTermsDays);

        Task Voucher(SafeTransactionKind kind, decimal amount, FundingSource? source = null, Guid? supplier = null) =>
            node.Send(new RecordSafeVoucherCommand(Guid.NewGuid(), new SafeVoucher(Guid.NewGuid(), kind, amount, today, source, SupplierId: supplier),
                null, "staff-omar", "Omar", true));
        async Task<Guid> Invoice(Guid supplier, string number, int daysAgo, decimal kg, decimal total, PurchasePaymentMethod method, decimal discount = 0)
        {
            var id = Guid.NewGuid();
            await node.Send(new SavePurchaseInvoiceCommand(id, supplier, number, today.AddDays(-daysAgo), [new PurchaseInvoiceLineEntry(tomatoes, kg, "kg", 1000, total)],
                "Omar", method, Discount: discount));
            await node.Send(new PostPurchaseInvoiceCommand(id, "Omar"));
            return id;
        }

        await Voucher(SafeTransactionKind.OpeningBalance, 10_000, FundingSource.CarriedOver);
        await node.Send(new SetSupplierOpeningBalanceCommand(Guid.NewGuid(), nile, 500, today.AddDays(-200), "Omar"));
        var f1 = await Invoice(nile, "F-1", 130, 10, 1_000, PurchasePaymentMethod.Credit);
        await Invoice(nile, "F-2", 50, 10, 2_000, PurchasePaymentMethod.Credit);
        await Invoice(nile, "F-3", 10, 10, 3_000, PurchasePaymentMethod.Credit);
        var cash = await Invoice(nile, "F-4", 0, 2, 400, PurchasePaymentMethod.Safe);
        await Voucher(SafeTransactionKind.SupplierPayment, 1_200, supplier: nile);
        await Invoice(delta, "D-1", 5, 10, 1_000, PurchasePaymentMethod.Safe, discount: 200);

        // Aged today: F-1 fell due 100 days ago (300 left of it), F-2 20 days ago, F-3 is due in 20 days.
        var aging = await node.Service<SupplierAccountsService>(scope).GetAgingAsync(null, ct);
        var row = Assert.Single(aging.Rows);
        Assert.Equal(("Nile Farms", 30, 5_300m, 3_000m, 2_000m, 0m, 0m, 300m, 3, (DateOnly?)today.AddDays(-100)),
            (row.Supplier, row.PaymentTermsDays, row.TotalOwed, row.Current, row.Days1To30, row.Days31To60, row.Days61To90, row.Over90, row.OpenInvoices,
                row.OldestDueDate));
        Assert.Equal((5_300m, 3_000m, 2_000m, 300m), (aging.TotalOwed, aging.Current, aging.Days1To30, aging.Over90));
        // Twenty days ago, before the payment and F-3: F-2 falling due that day, F-1 80 days late, the
        // 500 from before the treasury 180.
        var earlier = Assert.Single((await node.Service<SupplierAccountsService>(scope).GetAgingAsync(today.AddDays(-20), ct)).Rows);
        Assert.Equal((3_500m, 2_000m, 0m, 0m, 1_000m, 500m), (earlier.TotalOwed, earlier.Current, earlier.Days1To30, earlier.Days31To60, earlier.Days61To90, earlier.Over90));

        // The account for the last 60 days: 1,500 owed coming in.
        var account = (await node.Service<SupplierAccountsService>(scope).GetAccountAsync(nile, today.AddDays(-60), today, ct))!;
        Assert.Equal((1_500m, 5_000m, 400m, 1_200m, 5_300m), (account.OpeningBalance, account.CreditInvoices, account.CashInvoices, account.Payments, account.ClosingBalance));
        Assert.Equal(
            [
                (SupplierAccountEntryKind.CreditInvoice, "Invoice F-2", 0m, 2_000m, 3_500m),
                (SupplierAccountEntryKind.CreditInvoice, "Invoice F-3", 0m, 3_000m, 6_500m),
                (SupplierAccountEntryKind.CashInvoice, "Invoice F-4", 400m, 400m, 6_500m),
                (SupplierAccountEntryKind.Payment, "Payment voucher", 1_200m, 0m, 5_300m),
            ],
            account.Lines.Select(l => (l.Kind, l.Reference, l.Paid, l.Owed, l.Balance)));
        Assert.Equal((cash, "Omar"), (account.Lines[2].SourceId, account.Lines[3].RecordedBy));
        Assert.Equal([(f1, 300m)], account.OpenInvoices.Where(i => i.Paid > 0).Select(i => (i.InvoiceId, i.Remaining)));
        Assert.Null(await node.Service<SupplierAccountsService>(scope).GetAccountAsync(Guid.NewGuid(), null, null, ct));
        using (var book = new XLWorkbook(SupplierAccountWorkbook.Build(account)))
        {
            var sheet = book.Worksheet("Statement");
            Assert.Contains(sheet.RowsUsed(), r => r.Cell(2).GetString() == "Closing balance · الرصيد المستحق" && r.Cell(7).GetDouble() == 5_300);
        }

        // Over 250 days, the 500 owed before the treasury falls inside: added like an invoice, so
        // opening + owed before + credit invoices − payments is the closing, and the columns add up.
        var longer = (await node.Service<SupplierAccountsService>(scope).GetAccountAsync(nile, today.AddDays(-250), today, ct))!;
        Assert.Equal((0m, 500m, 6_000m, 400m, 1_200m, 5_300m),
            (longer.OpeningBalance, longer.OwedBefore, longer.CreditInvoices, longer.CashInvoices, longer.Payments, longer.ClosingBalance));
        Assert.Equal((1_600m, 6_900m), (longer.Lines.Sum(l => l.Paid), longer.Lines.Sum(l => l.Owed)));
        using (var book = new XLWorkbook(SupplierAccountWorkbook.Build(longer)))
            Assert.Contains(book.Worksheet("Statement").RowsUsed(), r => r.Cell(2).GetString() == "Closing balance · الرصيد المستحق"
                && r.Cell(5).GetDouble() == 1_600 && r.Cell(6).GetDouble() == 6_900 && r.Cell(7).GetDouble() == 5_300);

        // Vendor prices, net of every discount, per kg: Delta's 80 is the best; Nile's last is the cash 200.
        var intelligence = node.Service<IntelligenceService>(scope);
        var prices = Assert.Single((await intelligence.GetVendorPricesAsync(today.AddDays(-180), today, ct)).Rows);
        Assert.Equal((decimal?)150m, prices.SpreadPercent);
        Assert.Equal(
            [
                ("Delta Farms", (decimal?)80m, (decimal?)80m, (decimal?)80m, (decimal?)80m, 10m, 1, true),
                ("Nile Farms", 200m, 100m, 300m, 200m, 32m, 4, false),
            ],
            prices.Suppliers.Select(v => (v.Supplier, v.LastPrice, v.LowestPrice, v.HighestPrice, v.AveragePrice, v.Quantity, v.Purchases, v.BestPrice)));

        // The order to the cheapest supplier, at its price; or by who sold last.
        var cheapest = await intelligence.OrderSheetAsync(new OrderSheetRequest([new(tomatoes, 5)], OrderSheetGrouping.CheapestSupplier), ct);
        Assert.Equal(("Delta Farms", (decimal?)80m, (decimal?)400m), (cheapest.Rows[0].Group, cheapest.Rows[0].UnitPrice, cheapest.Rows[0].Cost));
        var latest = await intelligence.OrderSheetAsync(new OrderSheetRequest([new(tomatoes, 5)], OrderSheetGrouping.Supplier), ct);
        Assert.Equal(("Nile Farms", (decimal?)200m), (latest.Rows[0].Group, latest.Rows[0].UnitPrice));
    }
}
