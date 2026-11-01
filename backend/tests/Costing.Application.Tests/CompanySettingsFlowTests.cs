using Costing.Application.Approvals;
using Costing.Application.Company;
using Costing.Application.Hr;
using Costing.Domain.Common;
using Costing.Domain.Company;
using Costing.Domain.Employees;

namespace Costing.Application.Tests;

// Company Settings as the rest of HR reads them: saved, they are the app's at once; money in
// messages is the company's; the country decides the national IDs; and the weekends are only what
// a new employee starts with.
public class CompanySettingsFlowTests
{
    private static readonly CompanySettingsInput Riyadh = new(
        "Acme KSA", "SAR", CurrencyPosition.After, Country.SaudiArabia, "Asia/Riyadh", 4, [DayOfWeek.Friday, DayOfWeek.Saturday]);

    private static EmployeeDetails Details(string name, string? nationalId = null, IReadOnlyList<DayOfWeek>? daysOff = null) =>
        new(name, "Technician", 6_000, new TimeOnly(9, 0), daysOff ?? [DayOfWeek.Friday], new DateOnly(2026, 10, 1), null, NationalId: nationalId);

    [Fact]
    public async Task Saved_they_are_the_apps_at_once_and_made_the_first_time_from_what_it_started_with()
    {
        var hr = new TestHr();
        Assert.Null(hr.Hr.CompanySettings.Row);

        var saved = await hr.Send(new UpdateCompanySettingsCommand(Riyadh, "Omar"));

        Assert.Equal(("Acme KSA", "SAR", CurrencyPosition.After, Country.SaudiArabia, "Asia/Riyadh"),
            (saved.Name, saved.CurrencySymbol, saved.CurrencyPosition, saved.Country, saved.TimeZoneId));
        Assert.Equal([DayOfWeek.Friday, DayOfWeek.Saturday], saved.Weekends);
        Assert.Equal(("Asia/Riyadh", "1,400.00 SAR"), (hr.Company.Current.TimeZoneId, hr.Company.Current.Money.Format(1_400m)));
        Assert.Equal("Omar", hr.Hr.CompanySettings.Row!.UpdatedBy);
        Assert.Equivalent(saved, await hr.Send(new GetCompanySettingsQuery()), strict: true);
    }

    [Fact]
    public async Task Money_in_requests_and_refusals_is_the_companys()
    {
        var hr = new TestHr();
        var asked = await hr.Send(new ChangeEmployeeCommand(Guid.NewGuid(), Guid.NewGuid(), new EmployeeRequest(Details("Mona")), null, "u2", "Sara", CanApprove: false));
        Assert.Equal("New employee · Mona · Technician · L.E 6,000.00 a month, from 09:00", asked.Request!.Summary);

        await hr.Send(new UpdateCompanySettingsCommand(Riyadh, "Omar"));
        var lump = await hr.Send(new RecordHrAdvanceCommand(Guid.NewGuid(), Guid.NewGuid(), new HrAdvanceInput(300, new DateOnly(2026, 10, 20), null, null), "u2", "Sara", CanApprove: false));
        Assert.Equal("Advances not given out yet · 300.00 SAR", lump.Request!.Summary);
    }

    [Fact]
    public async Task The_country_decides_the_national_id_and_one_kept_stays_when_it_changes()
    {
        var hr = new TestHr();
        var id = Guid.NewGuid();
        await hr.Send(new ChangeEmployeeCommand(id, Guid.NewGuid(), new EmployeeRequest(Details("Hassan", "29001010123456")), null, "u1", "Omar", CanApprove: true));

        await hr.Send(new UpdateCompanySettingsCommand(Riyadh, "Omar"));
        // Their Egyptian card kept as it is, the rest of them changed.
        await hr.Send(new ChangeEmployeeCommand(id, Guid.NewGuid(), new EmployeeRequest(Details("Hassan Ali", "29001010123456")), null, "u1", "Omar", CanApprove: true));
        Assert.Equal(("Hassan Ali", "29001010123456"), (hr.Hr.Employees.All.Single().Name, hr.Hr.Employees.All.Single().NationalId));

        var refused = await Assert.ThrowsAsync<DomainException>(() => hr.Send(new ChangeEmployeeCommand(
            Guid.NewGuid(), Guid.NewGuid(), new EmployeeRequest(Details("Faisal", "29001010123457")), null, "u1", "Omar", CanApprove: true)));
        Assert.Contains("10 digits", refused.Message);
        await hr.Send(new ChangeEmployeeCommand(Guid.NewGuid(), Guid.NewGuid(), new EmployeeRequest(Details("Faisal", "1012345678")), null, "u1", "Omar", CanApprove: true));
    }

    [Fact]
    public async Task A_new_employees_blank_days_off_are_the_companys_weekends_and_nobody_elses_change()
    {
        var hr = new TestHr();
        var hassan = new Employee(Guid.NewGuid(), "Hassan", "Technician", 5_400, new TimeOnly(9, 0), WeekDays.Sunday, new DateOnly(2026, 1, 1));
        hr.Hr.Employees.Add(hassan);
        await hr.Send(new UpdateCompanySettingsCommand(Riyadh, "Omar"));

        var result = await hr.Send(new ImportEmployeesCommand(
            [
                new EmployeeSheetRow(2, "Faisal", "Monthly", "SAR 6,000", null, "Technician", "09:00", null, "2026-10-01", null),
                new EmployeeSheetRow(3, "Noura", "Monthly", "6000 ر.س", null, "Technician", "09:00", "None", "2026-10-01", null),
            ], "u1", "Omar", CanApprove: true));

        Assert.Empty(result.Skipped);
        var all = hr.Hr.Employees.All.ToDictionary(e => e.Name);
        Assert.Equal((WeekDays.Friday | WeekDays.Saturday, 6_000m), (all["Faisal"].DaysOff, all["Faisal"].MonthlySalary));
        Assert.Equal((WeekDays.None, 6_000m), (all["Noura"].DaysOff, all["Noura"].MonthlySalary));
        // Hassan's Sunday stays his.
        Assert.Equal(WeekDays.Sunday, all["Hassan"].DaysOff);
    }

    [Fact]
    public async Task A_logo_is_checked_by_its_bytes_and_read_back()
    {
        var hr = new TestHr();
        byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];

        await Assert.ThrowsAsync<DomainException>(() => hr.Send(new UploadCompanyLogoCommand("logo.png", "image/png", [1, 2, 3], "Omar")));
        var saved = await hr.Send(new UploadCompanyLogoCommand("logo.png", "image/png", png, "Omar"));
        Assert.True(saved.HasLogo);
        Assert.True(saved.LogoVersion > 0);
        Assert.Equal(("logo.png", "image/png", png), await hr.Send(new GetCompanyLogoQuery()) is { } logo ? (logo.FileName, logo.ContentType, logo.Content) : default);

        Assert.False((await hr.Send(new RemoveCompanyLogoCommand("Omar"))).HasLogo);
        Assert.Null(await hr.Send(new GetCompanyLogoQuery()));
    }
}
