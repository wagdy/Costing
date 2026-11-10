# Costing & Financials

Food costing, stock and the restaurant's money for one business, standalone: no point of sale or
HR system needed beside it. Bilingual (English and Arabic, right-to-left) throughout.

- **Raw materials**: units (a purchase unit and the unit it is used in), average cost, stock on
  hand, reorder levels, categories, and Excel export and import (to update them in bulk, or to
  move them to another installation).
- **Recipes**: recipe cards for menu items, their sizes and add-ons, and prep items (مصنعات) made
  from other materials, each costed from the materials' prices as they are now. Both export to a
  smart Excel sheet (each ingredient chosen from a dropdown that says its unit) and import back.
- **Production**: prep items made in batches, their materials taken from stock, their cost per
  unit worked out from what went in.
- **Menu**: categories, items numbered as their codes on every report, sizes and add-ons, kept
  here or imported from a point of sale's export.
- **Sales**: bills entered or imported, each line taking its stock by its recipe. A line voided
  before the kitchen takes nothing; after the kitchen, it is waste; refunded after payment, its
  share of the charge goes back and its stock returns. A sale voided puts back all it took.
- **Purchases**: suppliers' invoices (stock or general expenses), a day's purchases entered as one
  batch, invoice corrections, suppliers and categories. Expense items export to Excel and import
  back, as the raw materials do.
- **End of the day**: a branch closes its day from a phone: its invoices, cash and on credit, the
  cash it paid suppliers and advanced to staff, each photographed with its receipt, and its sales
  report with the drawer's float; it shows the net cash that should be left in the till. Submitted,
  the invoices open the daily batch, and each payment and advance goes to the safe (asked of a
  manager when it is not one handing it in).
- **Stock counts and waste**: counts drafted then posted, spoilage, and breakage.
- **Financials**: the safe, its funding, the day's takings (gross, with the tax in them taken off
  at the tax rate), expense vouchers, what suppliers are owed and paid, the staff the safe pays and
  their advances and salaries, and the tax and service settings.
- **Reports**: spending by category, theoretical cost, variance against the counts, KPIs (food
  cost, labour cost, prime cost) and break-even.
- **Approvals**: deletes, voids and corrections asked for by anyone but a manager wait for a
  manager's approval.
- **Users and permissions**: users sign in with an email and a password, as a Manager, an
  Accountant, a Cost Controller or a Storekeeper. Each role works its own sections until a manager
  ticks a user's on Permissions; the API holds every request to them.
- **POS link**: a point of sale sends each shift's Z report here, with a key a manager makes on
  Settings → POS Integration (kept only as its hash): it becomes the day's sales summary, its
  stock taken by the recipes and what was voided after the kitchen as waste, and the day's
  takings. Sent again it changes nothing; corrected, it replaces what it made; a day entered by hand
  is left alone. The POS reads the menu from here too, and every call is in the sync log.
- **Company Settings**: the company's name and logo, the currency (on every screen, sheet and
  message), the country, the time zone and the hour its business day starts.

The design, rule by rule, is in [docs/](docs/).

## Stack

- **Backend**: .NET 10, ASP.NET Core Web API, Clean Architecture (`Costing.Domain`,
  `Costing.Application` with MediatR, `Costing.Infrastructure` with EF Core on PostgreSQL and
  ClosedXML for the sheets, `Costing.Api`).
- **Frontend**: Angular 21 (standalone components, signals, zoneless), Angular Material,
  Vitest.
- **Database**: PostgreSQL 16, schemas `costing` and `identity`. The migrations are applied on
  start.

## Running it locally

You need the .NET 10 SDK, Node 22 with npm, and Docker.

1. Start the development database (PostgreSQL on `127.0.0.1:5436`):

   ```bash
   docker compose -f dev/docker-compose.yml up -d
   ```

2. Start the API on <http://localhost:5100>. It applies the migrations and makes the first
   manager from `Auth:FirstManager` in `appsettings.Development.json`:

   ```bash
   dotnet run --project backend/src/Costing.Api --launch-profile http
   ```

3. Start the app on <http://localhost:4230>, which forwards `/api` to the API:

   ```bash
   cd frontend && npm ci && npm start
   ```

Sign in with the first manager's email and password, change the password on Your account, then
add the other users on Users and give them their sections on Costing → Permissions.

The values in `appsettings.Development.json` are for a local machine only: the database password
is the development container's, and the signing key and first manager's password are placeholders.

## Configuration

| Setting | What it is |
| --- | --- |
| `ConnectionStrings:Costing` | The PostgreSQL database (or `DATABASE_URL`, `postgres://user:password@host:port/database`, which wins) |
| `Database:MigrateOnStartup` | Apply the migrations on start (true) |
| `Auth:SigningKey` | The key tokens are signed with, 32 bytes at least: `openssl rand -base64 48` |
| `Auth:TokenLifetimeHours` | How long a sign-in lasts (12 hours) |
| `Auth:FirstManager` | `Email`, `Name` and `Password` of the manager made when there is none |
| `Company:*` | The company's settings for the first start only: `Name`, `TimeZoneId` (`Africa/Cairo`), `WorkdayStartsAtHour` (4: a night past midnight belongs to the day before), `Country` (`Egypt` or `SaudiArabia`), `CurrencySymbol` and `CurrencyPosition` (`Before` or `After`). After that a manager changes them on Settings |
| `Cors:AllowedOrigins` | Browser origins allowed to call the API from elsewhere (the dev server's in development) |

## Tests

```bash
dotnet test --project backend/tests/Costing.Domain.Tests
dotnet test --project backend/tests/Costing.Application.Tests
```

The Infrastructure and Api tests run against PostgreSQL, each test in a database of its own.
Without `COSTING_TEST_DB` they are skipped, so check `skipped: 0`:

```bash
COSTING_TEST_DB="Host=localhost;Port=5436;Username=costing;Password=costing-dev" dotnet test --project backend/tests/Costing.Infrastructure.Tests
```

```bash
COSTING_TEST_DB="Host=localhost;Port=5436;Username=costing;Password=costing-dev" dotnet test --project backend/tests/Costing.Api.Tests
```

```bash
cd frontend && npx ng test --watch=false
```

## Building for production

The `Dockerfile` builds the app and the API into one image, the API serving the app beside `/api`:

```bash
docker build -t costing .
```

It listens on `PORT` (8080 unless the platform says). The database comes from `DATABASE_URL` or
`ConnectionStrings__Costing`; the migrations are applied on start. Set `Auth__SigningKey` and the
first manager (`Auth__FirstManager__*`) from the environment, never in a committed file. `/health`
says the process is up, `/health/ready` that it reaches its database too.

To deploy on Railway, see [docs/deploy-railway.md](docs/deploy-railway.md).
