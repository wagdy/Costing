using Costing.Domain.Common;
using Costing.Domain.EndOfDay;

namespace Costing.Domain.Tests;

public class EndOfDayTests
{
    private static readonly EndOfDayPhoto Photo = EndOfDayPhoto.Of("invoice.jpg", "image/jpeg", 2_000);
    private static readonly DateOnly Day = new(2026, 11, 4);

    [Fact]
    public void A_day_adds_up_its_cash_and_credit_invoices_against_its_sales()
    {
        var day = new EndOfDayReport(Guid.NewGuid(), Day, "Ali");
        day.AddInvoice(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, Guid.NewGuid(), 120.456m, null, Photo, "Ali");
        day.AddInvoice(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, Guid.NewGuid(), 80, "Gas", Photo, "Ali");
        day.AddInvoice(Guid.NewGuid(), EndOfDayInvoiceKind.Credit, Guid.NewGuid(), 500, null, Photo, "Ali");
        day.RecordSales(1_000, 400, 196, 15, null, "Ali");

        Assert.Equal((2, 200.46m, 1, 500m), (day.CountOf(EndOfDayInvoiceKind.Cash), day.TotalOf(EndOfDayInvoiceKind.Cash),
            day.CountOf(EndOfDayInvoiceKind.Credit), day.TotalOf(EndOfDayInvoiceKind.Credit)));
        Assert.Equal((1_400m, 1_596m, 799.54m, 1_395.54m), (day.NetSales, day.TotalRevenue, day.CashAfterInvoices, day.ExpectedIntoSafe));
    }

    [Fact]
    public void Submitted_it_is_kept_as_it_is_until_reopened_and_what_is_posted_stays_posted()
    {
        var day = new EndOfDayReport(Guid.NewGuid(), Day, "Ali");
        var invoice = day.AddInvoice(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, Guid.NewGuid(), 50, null, Photo, "Ali");
        Assert.Throws<DomainException>(() => day.Posted(invoice.Id, Guid.NewGuid()));

        day.RecordSales(100, null, 200, null, null, "Ali");
        Assert.StartsWith("The tax collected cannot be more", Assert.Throws<DomainException>(() => day.Submit("Ali")).Message);
        day.RecordSales(100, null, 14, null, null, "Ali");
        day.Submit("Ali");

        Assert.Throws<DomainException>(() => day.RecordSales(1, 1, 0, 0, null, "Ali"));
        Assert.Throws<DomainException>(() => day.RemoveInvoice(invoice.Id, "Ali"));
        var purchase = Guid.NewGuid();
        day.Posted(invoice.Id, purchase);
        day.Posted(invoice.Id, purchase);
        Assert.Throws<DomainException>(() => day.Posted(invoice.Id, Guid.NewGuid()));

        day.Reopen("Boss");
        Assert.Equal((EndOfDayStatus.Draft, "Boss"), (day.Status, day.ReopenedBy));
        Assert.Throws<DomainException>(() => day.ChangeInvoice(invoice.Id, EndOfDayInvoiceKind.Credit, Guid.NewGuid(), 50, null, "Ali"));
        Assert.Throws<DomainException>(() => day.Reopen("Boss"));
    }

    [Fact]
    public void The_cash_left_in_the_drawer_is_the_float_and_the_cash_sales_less_all_paid_out_of_it()
    {
        var day = new EndOfDayReport(Guid.NewGuid(), Day, "Ali");
        day.AddInvoice(Guid.NewGuid(), EndOfDayInvoiceKind.Cash, Guid.NewGuid(), 150, null, Photo, "Ali");
        // On credit: no cash left the drawer for it.
        day.AddInvoice(Guid.NewGuid(), EndOfDayInvoiceKind.Credit, Guid.NewGuid(), 900, null, Photo, "Ali");
        day.AddPayout(Guid.NewGuid(), EndOfDayPayoutKind.SupplierPayment, Guid.NewGuid(), 300, "Last week's bread", Photo, "Ali");
        day.AddPayout(Guid.NewGuid(), EndOfDayPayoutKind.EmployeeAdvance, Guid.NewGuid(), 200.004m, null, Photo, "Ali");
        // Cash 1,000 and Visa 500 before tax, the tax on both 210: the cash's share of it 140.
        day.RecordSales(1_000, 500, 210, 0, null, "Ali", openingFloat: 500);

        Assert.Equal((300m, 1, 200m, 1), (day.TotalOf(EndOfDayPayoutKind.SupplierPayment), day.CountOf(EndOfDayPayoutKind.SupplierPayment),
            day.TotalOf(EndOfDayPayoutKind.EmployeeAdvance), day.CountOf(EndOfDayPayoutKind.EmployeeAdvance)));
        Assert.Equal((140m, 1_140m, 650m), (day.CashTax, day.CashSalesCollected, day.CashPaidOut));
        // 500 + 1,140 − (150 + 300 + 200): the Visa never reaches the drawer.
        Assert.Equal(990m, day.NetCashInTill);
        // Into the safe: all the day took in, 1,710, less all paid out of it.
        Assert.Equal(1_060m, day.ExpectedIntoSafe);

        // No sales yet: the float alone, less what was paid out.
        var quiet = new EndOfDayReport(Guid.NewGuid(), Day, "Ali");
        quiet.AddPayout(Guid.NewGuid(), EndOfDayPayoutKind.EmployeeAdvance, Guid.NewGuid(), 50, null, Photo, "Ali");
        quiet.RecordSales(null, null, null, null, null, "Ali", openingFloat: 300);
        Assert.Equal((0m, 250m), (quiet.CashTax, quiet.NetCashInTill));
    }

    [Fact]
    public void A_payment_handed_in_needs_a_payee_and_an_amount_and_is_kept_as_it_is_once_it_went_to_the_safe()
    {
        var day = new EndOfDayReport(Guid.NewGuid(), Day, "Ali");
        var supplier = Guid.NewGuid();
        Assert.StartsWith("Choose the supplier", Assert.Throws<DomainException>(() =>
            day.AddPayout(Guid.NewGuid(), EndOfDayPayoutKind.SupplierPayment, Guid.Empty, 10, null, Photo, "Ali")).Message);
        Assert.StartsWith("Choose the employee", Assert.Throws<DomainException>(() =>
            day.AddPayout(Guid.NewGuid(), EndOfDayPayoutKind.EmployeeAdvance, Guid.Empty, 10, null, Photo, "Ali")).Message);
        Assert.StartsWith("Enter the amount paid", Assert.Throws<DomainException>(() =>
            day.AddPayout(Guid.NewGuid(), EndOfDayPayoutKind.EmployeeAdvance, Guid.NewGuid(), 0, null, Photo, "Ali")).Message);
        Assert.StartsWith("The opening float is zero or more", Assert.Throws<DomainException>(() =>
            day.RecordSales(100, null, null, null, null, "Ali", -1)).Message);

        var paid = day.AddPayout(Guid.NewGuid(), EndOfDayPayoutKind.SupplierPayment, supplier, 100, null, Photo, "Ali");
        day.ChangePayout(paid.Id, supplier, 120, " Flour ", "Ali");
        Assert.Equal((120m, "Flour", supplier, (Guid?)null), (paid.Amount, paid.Note, paid.PayeeId, paid.EmployeeId));
        // To the safe once the day is handed in, not before.
        Assert.Throws<DomainException>(() => day.Vouchered(paid.Id));
        day.RecordSales(100, null, 14, null, null, "Ali");
        day.Submit("Ali");
        day.Vouchered(paid.Id);

        day.Reopen("Boss");
        Assert.StartsWith("It went to the safe", Assert.Throws<DomainException>(() => day.ChangePayout(paid.Id, supplier, 50, null, "Ali")).Message);
        Assert.Throws<DomainException>(() => day.RemovePayout(paid.Id, "Ali"));
        // A clearer photo of its receipt: the money is as it was.
        day.ReplacePayoutReceipt(paid.Id, EndOfDayPhoto.Of("clear.jpg", "image/jpeg", 10), "Ali");
        Assert.Equal("clear.jpg", paid.Receipt.FileName);
        // Refused by a manager: nothing was entered for it, so it can go.
        day.RemovePayout(paid.Id, "Ali", voucherRefused: true);
        Assert.Empty(day.Payouts);
    }

    [Fact]
    public void A_photo_is_a_picture_or_a_pdf_under_ten_megabytes()
    {
        Assert.Throws<DomainException>(() => EndOfDayPhoto.Of("notes.txt", "text/plain", 10));
        Assert.Throws<DomainException>(() => EndOfDayPhoto.Of("huge.jpg", "image/jpeg", 11 * 1024 * 1024));
        Assert.Equal(("scan.pdf", "application/pdf"), (EndOfDayPhoto.Of("C:/x/scan.pdf", "Application/PDF", 10).FileName, EndOfDayPhoto.Of("scan.pdf", "Application/PDF", 10).ContentType));
    }
}
