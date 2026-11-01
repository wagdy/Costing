# Deploying to Railway

One service from this repository's `Dockerfile` (Railway finds it through `railway.json`), and a
PostgreSQL database beside it. The API serves the app and its own API on Railway's HTTPS domain,
and the attendance device calls in over a TCP Proxy to a port of its own.

## Why the device has a port of its own

Railway's domains are HTTPS only: a plain HTTP request is redirected to HTTPS, and that cannot be
turned off. A ZKTeco K40 calls ADMS over plain HTTP (Cloud Server Setting, HTTPS off), and does
not follow a redirect, so pointed at the HTTPS domain it never gets through. A Railway **TCP
Proxy** passes its plain HTTP straight to the container's device port, 5092, where the API
answers nothing but the device's `/iclock` paths.

## 1. The project and the database

1. New project → **Deploy from GitHub repo** → `wagdy/HR-Payroll`. Railway builds the
   `Dockerfile`.
2. In the same project: **New → Database → PostgreSQL**.

## 2. The service's variables

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (the database's own, by reference) |
| `Auth__SigningKey` | A secret of 32 bytes or more that you make: `openssl rand -base64 48`. Never commit it |
| `Auth__FirstManager__Email`, `Auth__FirstManager__Name`, `Auth__FirstManager__Password` | The first manager, made on the first start when there is no user yet. Sign in, change the password on Your account, then delete `Auth__FirstManager__Password` |
| `Company__Name`, `Company__TimeZoneId`, `Company__Country`, `Company__CurrencySymbol`, `Company__CurrencyPosition`, `Company__Weekends` | Optional: the company's settings for the first start (else "My company", Africa/Cairo, Egypt, L.E before, Friday). A manager changes them on Settings after |

`PORT`, `RAILWAY_PUBLIC_DOMAIN` and the TCP Proxy's `RAILWAY_TCP_PROXY_DOMAIN` and
`RAILWAY_TCP_PROXY_PORT` are Railway's own: the app reads them as they are. The image sets
`Attendance__DevicePort=5092` and trusts the proxy's forwarded headers
(`ASPNETCORE_FORWARDEDHEADERS_ENABLED`). The migrations are applied on every start.

## 3. Networking

In the service's **Settings → Networking**:

1. **Generate Domain** (HTTP): the app and its API, `https://<name>.up.railway.app`, on Railway's
   `PORT`.
2. **TCP Proxy** to port **5092**: Railway gives it an address such as
   `shuttle.proxy.rlwy.net:15140`.

Redeploy once both are there, so the service sees the proxy's variables. The Devices tab then
shows the proxy's address and port to give the device, and an employee's profile the portal's
address (`https://<name>.up.railway.app/portal`).

## 4. The K40

On the device: **Main menu → COMM. → Cloud Server Setting**:

- Server mode **ADMS**.
- **Enable Domain Name on**, Server Address the proxy's name (`shuttle.proxy.rlwy.net`).
- Server Port the proxy's port (`15140`).
- Proxy off, **HTTPS off**.

The device needs a DNS server to look the name up (**COMM. → Ethernet**: DNS, such as `8.8.8.8`),
and a way out to the internet. Restart it. Within a minute it is on the Devices tab, waiting:
approve it by name, and its punches start coming in, the ones it already holds too.

## Before you rely on it

- **The device's port is on the internet.** ADMS has no password: a device is known by its serial
  number, and nothing it sends counts until a manager approves that serial. Anyone who learns an
  approved device's serial (it is on its label) could send punches as it. Keep the serial to
  yourself, and look over Corrections for punches that make no sense. A punch never pays anyone
  by itself: each month is reviewed and finalized by a manager.
- **The device's clock** takes the company's time zone (Settings) each time it starts, as on the
  office network.
- **Backups:** Railway's PostgreSQL has its own backups; turn them on for the database.
