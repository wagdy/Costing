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
    public void A_photo_is_a_picture_or_a_pdf_under_ten_megabytes()
    {
        Assert.Throws<DomainException>(() => EndOfDayPhoto.Of("notes.txt", "text/plain", 10));
        Assert.Throws<DomainException>(() => EndOfDayPhoto.Of("huge.jpg", "image/jpeg", 11 * 1024 * 1024));
        Assert.Equal(("scan.pdf", "application/pdf"), (EndOfDayPhoto.Of("C:/x/scan.pdf", "Application/PDF", 10).FileName, EndOfDayPhoto.Of("scan.pdf", "Application/PDF", 10).ContentType));
    }
}
