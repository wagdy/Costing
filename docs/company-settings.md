# Company Settings (إعدادات الشركة)

The company this system runs for: its name and logo, how money is written, the country, the time
zone and the hour its workday starts, and the weekends a new employee starts with. A manager
keeps them on the Settings page; everyone reads them, the sign-in page and the portal too.

## Decided

- **Weekends are only a default.** They are the days off a new employee starts with: on the
  employee form, and for an Excel row whose Days Off is blank ("None" on the sheet is no day
  off). Changing them never changes anyone's days off already set, so no pay already worked out
  moves.
- **The country decides two things:**
  - the national IDs taken: Egypt's card is 14 digits; Saudi Arabia's national ID or Iqama is 10
    digits, starting 1 (a citizen's) or 2 (a resident's). A passport's number (its letters and
    digits) is taken anywhere. An ID already kept stays when the country changes: editing that
    employee does not ask for it again.
  - the public holidays offered on Leaves & Holidays: Egypt's fixed-date holidays and Sham
    El-Nessim; Saudi Arabia's Founding Day (22 February) and National Day (23 September). The
    holidays that follow the moon are entered once announced, as before.
- **A time zone change is allowed at any time, with a strong warning.** Before it is saved, the
  page says plainly that new punches fall into workdays by the new zone's clock from that moment,
  and that every attendance device must be restarted to take it; the manager ticks that they
  understand before Save is open. Days already worked out and finalized pay stay as they are.
- **The currency symbol is everywhere:** the screens, the Excel sheets (each amount cell formatted
  with it, its value still the number) and the API's own messages ("Advance · Hassan · L.E
  500.00", "L.E 500.00 of their pay is still owed"). Amounts are stored as numbers; only how they
  are written changes.

## The model

**`CompanySettings`** (`hr.CompanySettings`, one row, `Id` 1): `Name`, `CurrencySymbol` (up to 8
characters, or none for numbers alone), `CurrencyPosition` (`Before` or `After`), `Country`
(`Egypt`, `SaudiArabia`), `TimeZoneId` (an IANA id the server knows), `WorkdayStartsAtHour` (0 to
12), `Weekends` (days, at least one working day left), the logo's file name, type, size and when it
last changed, and who saved them last. **`CompanyLogo`** (`hr.CompanyLogos`) keeps the logo's
bytes apart, so reading the settings never loads the picture. Migration `CompanySettingsAndLogo`.

The first start makes the row from the configuration's `Company` section (`Name`, `TimeZoneId`,
`WorkdayStartsAtHour`, `Country`, `CurrencySymbol`, `CurrencyPosition`, `Weekends`); from then on
the database's are the company's.

**In memory:** the settings are held for the whole app (`ICompanyProfile`), read at start-up and
replaced as a manager saves. The clock (`WorkClock`), the messages and the next new employee
follow a save at once, without a restart. One API process holds them: a second process would see
another's save only when it starts again.

## The API

| Endpoint | Who | What it does |
| --- | --- | --- |
| `GET /api/settings` | Anyone, signed in or not | The settings, with `hasLogo` and `logoVersion` |
| `PUT /api/settings` | `settings.manage` (a manager) | Saves `{ name, currencySymbol, currencyPosition, country, timeZoneId, workdayStartsAtHour, weekends }` |
| `GET /api/settings/logo` | Anyone | The logo (`?v=` its version, cached a day) |
| `PUT /api/settings/logo`, `DELETE …/logo` | `settings.manage` | A PNG, JPEG or WebP of up to a megabyte, checked by its first bytes (never an SVG), or taken off |

The portal's port answers `GET /api/settings` and the logo, never a change.

## The screens

- **Settings** (a manager's, in the top bar): the company's name and logo; the currency symbol and
  where it goes, with "1,400.00" shown as it will read; the country, the time zone (typed or
  picked from the browser's list) and the hour the workday starts; and the weekends.
- **The logo and name** in the top bar, on the sign-in page (everyone's, the portal's too) and on every
  payslip, printed ones too.
- **Money** through one pipe and one formatter, so every amount in the app follows the setting.
