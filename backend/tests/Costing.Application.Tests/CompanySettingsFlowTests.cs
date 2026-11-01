using Costing.Application.Common;
using Costing.Application.Company;
using Costing.Application.Treasury;
using Costing.Domain.Company;
using Costing.Domain.Treasury;

namespace Costing.Application.Tests;

// Company Settings: made from the configuration the first time, changed by a manager, and the
// system's own messages writing amounts in the company's currency at once.
[Collection(nameof(CompanyMoney))]
public class CompanySettingsFlowTests
{
    [Fact]
    public async Task A_saved_currency_is_how_the_messages_write_amounts_from_then_on()
    {
        var costing = new TestCosting();
        Assert.Null(costing.Settings.Row);
        try
        {
            var saved = await costing.Send(new UpdateCompanySettingsCommand(
                new CompanySettingsInput("Acme KSA", "SAR", CurrencyPosition.After, Country.SaudiArabia, "Asia/Riyadh", 5), "Omar"));
            Assert.Equal(("Acme KSA", "SAR", CurrencyPosition.After, 5), (saved.Name, saved.CurrencySymbol, saved.CurrencyPosition, saved.WorkdayStartsAtHour));
            Assert.Equal("Omar", costing.Settings.Row!.UpdatedBy);

            var asked = await costing.Send(new RecordSafeVoucherCommand(
                Guid.NewGuid(), new SafeVoucher(Guid.NewGuid(), SafeTransactionKind.OpeningBalance, 1_250, TestCalendar.Today, FundingSource.CarriedOver), null,
                "staff-mona", "Mona", CanApprove: false));
            Assert.Contains("1,250.00 SAR", asked.Request!.Summary);
        }
        finally
        {
            CompanyMoney.Format = new MoneyFormat("L.E", CurrencyPosition.Before);
        }
    }
}

[CollectionDefinition(nameof(CompanyMoney), DisableParallelization = true)]
public sealed class CompanyMoneyCollection;
