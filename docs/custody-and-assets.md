# Custody & Assets (عهدة وأصول), and the employee portal

What the company owns, what is in whose custody, the vouchers that move it, and a self-service
portal where an employee sees their own details, payslip, leaves and custody.

## The choices made

- **A quantity per asset** (not one row per piece): "Desk lamps × 40" at a cost a piece; a fixed
  asset × 1. Vouchers move a number of them.
- **What breaks or is lost only changes the asset**: how many are left, and with none left its
  status (Broken, or Discarded). Nothing goes to any other ledger.
- **The portal is reached on the office Wi-Fi**, through a port of its own that answers only the
  employee login, the portal's own API and the HR tabs a manager gave an employee. Five wrong
  PINs lock it for five minutes.

## The model

**`AssetCategory`** (`hr.AssetCategories`): a name (unique) and `IsConsumable`: the fragile and
worn (cups, uniforms) or a fixed asset (a laptop, a forklift).

**`AssetItem`** (`hr.AssetItems`): a name, a category (or none), a cost a piece (or none known),
a `Quantity`, the employee whose custody it is in (`EmployeeId`, none in the store or at
maintenance), and its `Status`:
- `InStore` (with no one: not handed out yet, or handed back), `InCustody`, `Maintenance`,
  `Broken` (all of it broken), `Discarded` (all of it lost or thrown away).
- It changes hands only by vouchers. Nothing is deleted: what is gone stays, with none left.

**`AssetTransaction`** (`hr.AssetTransactions`), a custody voucher (إذن), made by the asset:
- `CheckIn` (إذن دخول): all of it into an employee's custody: from the store, back from
  maintenance, or from no one. One in someone else's custody is checked out from them first.
- `CheckOut` (إذن خروج), with a `Reason`:
  - `Returned` (مرتجع) to the store, or `Maintenance` (صيانة): all of it, from whoever held it;
  - `Breakage` (كسر), `Lost` (فقد) or `Discarded` (استبعاد): some of it, the rest staying where it
    is; with none left, it is `Broken` (broken) or `Discarded` (lost or thrown away), with no one.
- It keeps the date (a workday), who held it (`EmployeeId`), how many, the cost a piece as it
  was then, and the notes.

**`Employee`**: the portal PIN, kept hashed (`PinHash`; never stored or shown as typed), 4 to 6
digits, with `FailedPinAttempts` and `PinLockedUntilUtc` (five misses lock it five minutes; a
manager setting a new PIN unlocks it). A PIN needs a mobile number, which they sign in with:
**one employee to a mobile number** (a unique index, and the employee form says who has it).

## The API

**Who:** whoever holds the Custody tab. Categories are a manager's. Assets and vouchers are
whoever manages HR's: a manager's at once (200), an accountant's asked of a manager (202,
approval module `Custody`), the asset locked until decided. A portal PIN is a manager's to set.

| Endpoint | What it does |
| --- | --- |
| `GET /api/custody/categories` | The categories, with how many assets are in each and in custody |
| `PUT /api/custody/categories/{id}`, `DELETE …/{id}` | Added or renamed, consumable or not; deleted only with nothing in it: a manager's |
| `GET /api/custody/assets` | The assets |
| `GET /api/custody/assets/{id}` | One asset with its vouchers, the latest first |
| `PUT /api/custody/assets/{id}` | Added or changed: name, category, cost a piece, notes; how many is set when added, and changes by vouchers after |
| `POST /api/custody/assets/{id}/check-in` | إذن دخول: into an employee's custody (`employeeId`, `date` today unless given, none after it) |
| `POST /api/custody/assets/{id}/check-out` | إذن خروج: `reason` (Returned, Maintenance, Breakage, Lost, Discarded) and `quantity` |
| `GET /api/custody/vouchers?from=&to=` | The vouchers of those workdays (the last 30 unless said) |
| `GET /api/hr/employees/{id}/custody` | What is in their custody now, since when, and what it cost |
| `GET /api/custody/consumables`, `GET …/consumables/{id}` | جرد الاستهلاكيات: the supplies used up from the store, their stock, average unit cost, value and whether low; one with its movements, the latest first |
| `PUT /api/custody/consumables/{id}`, `DELETE …/{id}` | Added or changed: name, unit, the level it is low at, notes; deleted only before anything was recorded of it |
| `POST /api/custody/consumables/{id}/movements` | `type` Received (`unitCost`, or none: at the average; an employee's always at it), Consumed (never more than in stock), or Counted (`quantity` what was counted: the stock set to it, the difference kept); `movementId` made by the app, so a retry records it once; `date` today unless given, none after it. Made at once: nothing here is in anyone's custody |
| `PUT /api/hr/employees/{id}/pin`, `DELETE …/pin` | Their portal PIN set (4 to 6 digits; it signs them out and unlocks them) or taken off: a manager's. `EmployeeDto` says `hasPin` and `pinSetAtUtc`, never the PIN |
| `POST /api/auth/employee-login` | `mobileNumber` and `pinCode` → a token with the role `Employee` and their id; one answer, "Wrong mobile number or PIN.", whether or not the number is anyone's |
| `GET /api/portal/me`, `…/id-photo`, `…/payslip-months`, `…/payslip?month=`, `…/custody` | The portal, read-only, only ever the signed-in employee's own, from their token |
| `GET /api/portal/custody` | Their custody as `EmployeeCustodyDto`: `name`, `category` and `quantity` alone, those of one name and category (handed over apart) on one line, added up. No cost, id or date: what an asset cost never reaches the employee's phone |

**The portal's security:**
- An employee token holds the role `Employee`, never a user role (Manager or Accountant): the
  API's default and fallback policies require a user role, so it passes nothing but the
  `Employee` policy on `/api/portal`, and the HR tabs a manager gave them. A user's token does
  not pass the `Employee` policy.
- Every request with it checks the employee is still employed and the token carries the PIN and
  the HR tabs they have now: a new PIN, none, other tabs, or their leaving signs them out at once.
- Five wrong PINs lock it five minutes; ten sign-ins a minute from one address at most.
- **The portal's port** (`Portal:Port`, unset unless configured) answers only
  `POST /api/auth/employee-login`, `/api/portal/*`, and `/api/hr/*`, `/api/custody/*`,
  `/api/leaves/*` and `/api/performance/*` (for the tabs a manager gave an employee; only an
  employee's token holds a tab there) and the app's files (GET); the rest of the API, the hub,
  `/iclock` and the health checks are not found there. Its address alone, or any screen other
  than `/sign-in`, `/portal`, `/my-profile`, `/hr` and `/custody`, sends a phone to `/sign-in`,
  where a user's email is refused (its sign-in is not found there).

## The screens

- **Custody & Assets** (its own section, the Custody tab: a manager's, an accountant's when a
  manager ticked it, and an employee's given it, in the portal; a change to an asset by anyone
  but a manager goes to a manager, and an employee holding the tab makes the categories at
  once): Categories, Assets, and Vouchers. An employee is shown no cost, and an asset they
  change keeps its own.
- **The employee profile**: an Assigned custody card, and a Portal card where a manager sets,
  changes or takes off the PIN and sees the portal's Wi-Fi address.
- **The portal** (signed in on the one sign-in, `/sign-in`, with their mobile number and PIN;
  `/portal` opens it too; then `/my-profile`): the employee's details and ID card, their
  payslip (this month's draft, or one before), their leaves, and their custody as Asset |
  Category | Quantity, with nothing of what it cost; read-only, and nothing of the system's
  navigation. On a phone: details, custody, then the payslip.

## Consumables inventory (جرد الاستهلاكيات)

Supplies bought, kept in the store and used up (napkins, detergent, gloves, takeaway cups) are
not assets: nobody holds them in custody. Each is a `ConsumableItem` counted in its unit (a
piece, a box, a kilo; to the thousandth), with what a unit cost on average. Its stock changes only
by a `ConsumableMovement`: stock received at its price moves the average; what is used up, or
found short on a count, goes at the average; a count sets the stock to what was counted and keeps
the difference. Nothing is deleted once recorded. At or under its reorder level an item is low.
Whoever manages on the Custody tab records them at once; an employee there is never sent a cost
(`HrPrivacyFilter` clears `unitCost`, `totalCost` and `cost`).

## Not decided yet

Undoing a voucher made in error; adding units to an asset (a new purchase is a new asset for
now).
