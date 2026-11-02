# Company Settings (إعدادات الشركة)

The business this system runs for: its name and logo, how money is written, the country, the time
zone and the hour its business day starts. A manager keeps them on the Settings page; everyone
reads them, the sign-in page too.

## Decided

- **The currency symbol is on the screens and in the API's own messages** ("Salary · Hassan ·
  October 2026 · L.E 5,000.00"). Amounts are stored as numbers; only how they are written
  changes. A symbol of none writes the numbers alone. The import templates keep their amounts as
  plain numbers.
- **A time zone change is allowed at any time, with a strong warning.** Before it is saved, the
  page says plainly that new sales, takings and entries fall on business days by the new zone's
  clock from that moment, and that today's business day may change; the manager ticks that they
  understand before Save is open. What is recorded already stays on its day.
- **The business day starts at the company's hour** (`WorkdayStartsAtHour`, 0 to 12, 4 by
  default): a sale at 01:30 belongs to the day before, as a restaurant's night does.

## The model

**`CompanySettings`** (`costing.CompanySettings`, one row, `Id` 1): `Name`, `CurrencySymbol` (up
to 8 characters, or none), `CurrencyPosition` (`Before` or `After`), `Country` (`Egypt`,
`SaudiArabia`), `TimeZoneId` (an IANA id the server knows), `WorkdayStartsAtHour`, the logo's file
name, type, size and when it last changed, and who saved them last. **`CompanyLogo`** keeps the
logo's bytes apart, so reading the settings never loads the picture.

The first start makes the row from the configuration's `Company` section (`Name`, `TimeZoneId`,
`WorkdayStartsAtHour`, `Country`, `CurrencySymbol`, `CurrencyPosition`); from then on the
database's are the company's.

**In memory:** the settings are held for the whole app (`ICompanyProfile`), read at start-up and
replaced as a manager saves. The clock (`WorkClock`) and the messages follow a save at once,
without a restart. One API process holds them: a second process would see another's save only
when it starts again.

## The API

| Endpoint | Who | What it does |
| --- | --- | --- |
| `GET /api/settings` | Anyone, signed in or not | The settings, with `hasLogo` and `logoVersion` |
| `PUT /api/settings` | `settings.manage` (a manager) | Saves `{ name, currencySymbol, currencyPosition, country, timeZoneId, workdayStartsAtHour }` |
| `GET /api/settings/logo` | Anyone | The logo (`?v=` its version, cached a day) |
| `PUT /api/settings/logo`, `DELETE …/logo` | `settings.manage` | A PNG, JPEG or WebP of up to a megabyte, checked by its first bytes (never an SVG), or taken off |

## The screens

- **Settings** (top bar, a manager's): the name and logo, the currency with a preview of how an
  amount will read, the country, the time zone and the hour the business day starts.
- **The top bar and the sign-in page** show the logo, or the name's initials, and the name.
