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
Every endpoint answers at `/api/company-settings` and at `/api/settings` alike.

| Endpoint | Who | What it does |
| --- | --- | --- |
| `GET /api/company-settings` | Anyone, signed in or not | The settings, with `hasCustomLogo`, `logoVersion` and `logoUrl` (the logo's address with its version, null with none) |
| `PUT /api/company-settings` | `settings.manage` (a manager) | Saves `{ name, currencySymbol, currencyPosition, country, timeZoneId, workdayStartsAtHour }` |
| `GET /api/company-settings/logo` | Anyone | The logo. With `?v=` its version: cached a year (`immutable`); without: `no-cache`, checked by its ETag (304 when unchanged). Served with `nosniff` and a sandboxing Content-Security-Policy |
| `PUT /api/company-settings/logo` (multipart `file`) | `settings.manage` | A PNG, SVG, JPEG, WebP or ICO of up to two megabytes, replacing the one there was |
| `DELETE /api/company-settings/logo` | `settings.manage` | Back to the system's own icon |

**What a logo is** is read from its bytes, not from the type the browser sent: PNG, JPEG, WebP and
ICO by their first bytes; an SVG when it parses as XML with an `<svg>` root and has no DTD, no
processing instruction, no `<script>`, `<foreignObject>` or embedded page, no `on…` event handler, no
`javascript:` and no link but to itself (`#id`) or to a picture inside it (`data:image/…`).
Anything else is refused with a 422.

## The browser tab's icon

The system has its own icons in `frontend/public/` (`favicon.svg`, `favicon.ico` at 16, 32 and 48
pixels, `apple-touch-icon.png` at 180): an emerald-to-indigo calculator. `index.html` names them
with `?v=2`, since static files are cached a year and `index.html` never is. Once a logo is
uploaded, `TabIcon` (`core/settings/tab-icon.ts`) replaces the head's icon links with the logo's
address, at start-up and the moment a logo is uploaded or taken off, with no reload.

## The screens

- **Settings** (top bar, a manager's): the name, the currency with a preview of how an amount will
  read, the country, the time zone and the hour the business day starts; and **Company logo &
  browser tab icon** (شعار الشركة وأيقونة التبويب), previewing the tab and the top bar as they will
  look, with **Upload logo** and **Reset to default**.
- **The top bar and the sign-in page** show the logo, or the system's mark (the sign-in page the
  name's initials), and the name.
