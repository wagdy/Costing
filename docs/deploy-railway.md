# Deploying to Railway

One service from this repository's `Dockerfile` (Railway finds it through `railway.json`), and a
PostgreSQL database beside it. The API serves the app and its own API on Railway's HTTPS domain.

## 1. The project and the database

1. New project → **Deploy from GitHub repo** → `wagdy/Costing`. Railway builds the `Dockerfile`.
2. In the same project: **New → Database → PostgreSQL**.

## 2. The service's variables

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (the database's own, by reference) |
| `Auth__SigningKey` | A secret of 32 bytes or more that you make: `openssl rand -base64 48`. Never commit it |
| `Auth__FirstManager__Email`, `Auth__FirstManager__Name`, `Auth__FirstManager__Password` | The first manager, made on the first start when there is no user yet. Sign in, change the password on Your account, then delete `Auth__FirstManager__Password` |
| `Company__Name`, `Company__TimeZoneId`, `Company__WorkdayStartsAtHour`, `Company__Country`, `Company__CurrencySymbol`, `Company__CurrencyPosition` | Optional: the company's settings for the first start (else "My company", Africa/Cairo, 4, Egypt, L.E before). A manager changes them on Settings after |

`PORT` is Railway's own: the app listens on it. The image trusts the proxy's forwarded headers
(`ASPNETCORE_FORWARDEDHEADERS_ENABLED`), so the sign-in limits count each client's own address.
The migrations are applied on every start.

## 3. Networking

In the service's **Settings → Networking**: **Generate Domain** (HTTP). The app and its API are at
`https://<name>.up.railway.app`.

Railway checks `/health/ready` (the process is up and reaches its database) before it sends
traffic to a new deployment (`railway.json`).

## 4. The first sign-in

1. Sign in as the first manager, and change the password on Your account.
2. On **Settings**: the company's name, logo, currency and time zone.
3. On **Users**: the accountants, cost controllers and storekeepers; on **Costing →
   Permissions**, the sections each works if not their role's.
4. On **Financials → Tax & service**: the tax rate the bills are charged.
5. The menu (Menu → Import, from the template), the raw materials (Raw materials → Import) and the
   recipes, then the sales as they come.

## Before you rely on it

- **Backups:** Railway's PostgreSQL has its own backups; turn them on for the database.
- **One process:** the company's settings are held in memory by the process that saved them. Run
  one replica.
