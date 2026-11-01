# HR & Payroll

HR, attendance, payroll, and custody of company assets for one company, with an employee
self-service portal. Bilingual (English and Arabic) throughout.

- **Employees**: profiles with their ID card, departments and job roles, monthly or daily pay,
  a nine-hour work schedule or flexible hours, and an Excel import and export.
- **Attendance**: punches pushed by a ZKTeco device (ADMS) or read from it over TCP 4370, worked
  out into days: late, leaving early, away, overtime, absences, forgotten punch-outs, public
  holidays and administrative penalties. Who is in now, live.
- **Payroll**: each month's payslip from base salary to net payable, incentives and allowances,
  advances deducted (an employee's own, or their share of a lump sum), finalized by a manager
  and paid by salary payments. A day's labour cost and each department's.
- **Leaves**: leave types, yearly balances, and requests a manager approves.
- **Performance & disciplinary**: KPIs, evaluations, warnings and penalty deductions.
- **Custody & Assets**: assets by category, check-in and check-out vouchers, and what is in
  whose custody. What breaks or is lost only changes the asset's status.
- **Company Settings**: the company's name and logo, the currency (on every screen, sheet and
  message), the country (its national IDs and public holidays), the time zone and workday, and
  the weekends new employees start with.
- **Roles and approvals**: users sign in with an email and a password, as a Manager or an
  Accountant. An accountant works the tabs a manager gives them, and their changes wait for a
  manager's approval. Everyone signs in on one page: a user with their email and password, an
  employee with their mobile number and a PIN, who goes to their own portal and can be given HR
  tabs to work there.

The design, rule by rule, is in [docs/](docs/).

## Stack

- **Backend**: .NET 10, ASP.NET Core Web API, Clean Architecture (`Costing.Domain`,
  `Costing.Application` with MediatR, `Costing.Infrastructure` with EF Core on PostgreSQL,
  `Costing.Api`), SignalR for live attendance.
- **Frontend**: Angular 21 (standalone components, signals, zoneless), Angular Material,
  Vitest.
- **Database**: PostgreSQL 16, schemas `hr` and `identity`.

## Running it locally

You need the .NET 10 SDK, Node 22 with npm, and Docker.

1. Start the development database (PostgreSQL on `127.0.0.1:5435`):

   ```bash
   docker compose -f dev/docker-compose.yml up -d
   ```

2. Start the API on <http://localhost:5090>. It applies the migrations and makes the first
   manager from `Auth:FirstManager` in `appsettings.Development.json`. It also listens on the
   office network on two ports of their own: **5092** for the attendance device (ADMS, nothing
   but `/iclock`) and **5093** for the employee portal on phones. The Devices tab shows this
   machine's network address and the device's port to enter on the device:

   ```bash
   dotnet run --project backend/src/Costing.Api --launch-profile http
   ```

3. Start the app on <http://localhost:4220>, which forwards `/api` and `/hubs` to the API:

   ```bash
   cd frontend && npm ci && npm start
   ```

Sign in with the first manager's email and password, then add the other users on Users.

## Configuration

| Setting | What it is |
| --- | --- |
| `ConnectionStrings:Costing` | The PostgreSQL database |
| `Auth:SigningKey` | The key tokens are signed with, 32 bytes at least: `openssl rand -base64 48` |
| `Auth:TokenLifetimeHours` | How long a sign-in lasts (12 hours) |
| `Auth:FirstManager` | `Email`, `Name` and `Password` of the manager made when there is none |
| `Company:*` | The company's settings for the first start only: `Name`, `TimeZoneId` (`Africa/Cairo`), `WorkdayStartsAtHour` (4: a night past midnight belongs to the day before), `Country` (`Egypt` or `SaudiArabia`), `CurrencySymbol` and `CurrencyPosition` (`Before` or `After`), `Weekends`. After that a manager changes them on Settings |
| `Portal:Port` | A port that answers only the employee portal, for the office Wi-Fi (5093 in development; unset: none), listened on for the network in `Urls` too |
| `Attendance:DevicePort` | A port that answers only the attendance device (5092 in development; unset: the device uses the API's port). The API must also listen on it for the network, in `Urls`: `http://0.0.0.0:5092` |
| `Cors:AllowedOrigins` | Browser origins allowed to call the API from elsewhere |

## Tests

```bash
dotnet test --project backend/tests/Costing.Domain.Tests
dotnet test --project backend/tests/Costing.Application.Tests
```

The Infrastructure and Api tests run against PostgreSQL, each test in a database of its own.
Without `HRPAYROLL_TEST_DB` they are skipped, so check `skipped: 0`:

```bash
HRPAYROLL_TEST_DB="Host=localhost;Port=5435;Username=hr;Password=hr-dev" dotnet test --project backend/tests/Costing.Infrastructure.Tests
```

```bash
HRPAYROLL_TEST_DB="Host=localhost;Port=5435;Username=hr;Password=hr-dev" dotnet test --project backend/tests/Costing.Api.Tests
```

```bash
cd frontend && npx ng test --watch=false
```

## Building for production

The `Dockerfile` builds the app and the API into one image, the API serving the app beside `/api`:

```bash
docker build -t hr-payroll .
```

It listens on `PORT` (8080 unless the platform says) and on the attendance device's own port
5092. The database comes from `DATABASE_URL` (`postgres://user:password@host:port/database`) or
`ConnectionStrings__Costing`; the migrations are applied on start. Set `Auth__SigningKey` and
the first manager (`Auth__FirstManager__*`) from the environment, never in a committed file.

To deploy on Railway, with the device calling in over the internet, see
[docs/deploy-railway.md](docs/deploy-railway.md).
