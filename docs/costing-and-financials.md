# Costing & Financials (التكاليف والماليات)

The restaurant's food cost and money, standalone. The costing logic is the till's own, kept as it
was: the same recipes, stock movements, average costs, reports and approvals. What the till and HR
used to give it, it now keeps itself: the menu, the sales, the staff the safe pays, and the tax
rate. One business per deployment.

## The sections

Each is a section of the sidebar (a drawer on a phone), opened by its address only for whoever
works it.

| Section | Path | What it holds |
| --- | --- | --- |
| Raw materials (الخامات) | `/costing/materials` | Materials, their units, prices and stock; an Excel import |
| Recipes (الوصفات) | `/costing/recipes` | Recipe cards, prep items (مصنعات) and recipe categories |
| Production (الإنتاج) | `/costing/production` | Prep items made in batches |
| Menu (قائمة الطعام) | `/costing/menu` | Categories, items, sizes, add-ons; an Excel import |
| Sales (المبيعات) | `/costing/sales` | Bills entered or imported, refunds and voids |
| Purchases (المشتريات) | `/costing/purchases` | Invoices, the day's batch, suppliers, categories |
| Expense items (المصروفات العمومية) | `/costing/expense-items` | General expenses, never stock |
| Stock counts (الجرد) | `/costing/counts` | Counts drafted, then posted |
| Waste (الهالك) | `/costing/waste` | Spoilage, and breakage |
| Financials (الماليات) | `/costing/financials` | The safe, funding, takings, vouchers, suppliers owed and paid, advances, staff, tax and service |
| Reports (التقارير) | `/costing/reports` | Spending, theoretical cost, variance, KPIs, break-even |
| Cost settings (إعدادات التكاليف) | `/costing/settings` | Cost targets, beverage categories, shared costs, monthly expenses |
| Approvals (طلبات معلقة) | `/costing/approvals` | What waits for a manager |
| Permissions (الصلاحيات) | `/costing/permissions` | Who works which section; a manager's |

Users, Company Settings and each user's own account are in the top bar.

## Roles and permissions

Four roles. A role gives permissions (what a user may do anywhere) and the sections it works
until a manager ticks a user's own:

| Role | Permissions | Sections, until a manager ticks theirs |
| --- | --- | --- |
| Manager (مدير) | All: `inventory.view`, `inventory.manage`, `costing.view`, `approval.decide`, `users.manage`, `settings.manage` | Every section, always |
| Accountant (محاسب) | `inventory.view`, `inventory.manage`, `costing.view` | Raw materials, Expense items, Purchases, Financials, Sales, Reports |
| Cost Controller (مراقب تكاليف) | `inventory.view`, `inventory.manage`, `costing.view` | Raw materials, Recipes, Production, Menu, Sales, Stock counts, Waste, Reports, Cost settings |
| Storekeeper (أمين المخزن) | `inventory.view`, `inventory.manage` | Raw materials, Purchases, Stock counts, Waste, Production |

- **The sections a manager ticks replace the role's.** `UserTabAccess` (`costing.UserTabAccess`)
  keeps them, with who ticked them and when; "Their role's" on Permissions deletes the row and
  the user works their role's again. A manager's own are never restricted.
- **The API holds every request to them.** Each endpoint names the sections that may call it
  (`[CostingTab(...)]`); a request from a user who works none of them is refused (403), whatever
  the screen showed. A list another section needs too (the raw materials for a recipe, the
  suppliers for Financials) names those sections as well.
- **A storekeeper sees no costs** (`costing.view`): the stock without its value.
- **What a manager decides waits for one.** Anyone else's delete, void, correction, production
  order or safe entry is a request (`ApprovalRequest`) until a manager approves it on Approvals;
  nothing moves until then. The modules: recipes, purchase invoices, waste, stock counts, raw
  materials, prep items, production orders, the safe, purchase categories, sales and breakage.

`GET /api/auth/me` gives the user's permissions and their sections (`tabs`); the app shows only
those. `GET /api/access` lists every user's sections and `PUT /api/access/{userId}` sets them
(`{ tabs: [...] }`, or `{ tabs: null }` for their role's), for `users.manage`.

## Raw materials and expense items in Excel

Both pages have **Export Excel** (تصدير إلى إكسل) and **Import Excel** (استيراد من إكسل). The
export is the list as it is, under the template's columns, so it imports back as it is: edited
and imported into the same installation, or imported into another (a laptop's list into the one
online). The import dialog takes the file dropped or chosen, offers the template, and says what it
did: those added, those changed and in what, those already as the sheet has them, and each row
skipped by its number on the sheet and why, in English and Arabic.

| Sheet | Columns |
| --- | --- |
| Raw Materials | Code, Material Name, Category, Unit of Measure (Kg, Liter, Piece), Purchase Unit, Purchase Unit Holds (in kg, litres or pieces), Cost per Purchase Unit, Reorder Level (in purchase units), Yield % |
| Expense Items | Expense Name, Arabic Name, Category, Unit |

Columns are found by their heading, in English or Arabic, wherever they are; the earlier
template's four columns (its Initial Cost is per kg, litre or piece) still import.

- **A row is the material of its code, else of its name** (capitals and spacing aside), and that
  one is changed as the row says; a new name adds one. An expense item is found by its name. A
  blank cell leaves that detail as it is.
- **Never twice:** a name or code already on an earlier row, a code that is one material's while
  the name is another's, or a code two materials share is skipped, said why.
- **Skipped, not changed:** a deleted material or archived expense item (restore it first), a prep
  item (Recipes → Prep items), one waiting for a manager's approval, and a unit other than the one
  a material is counted in (changed on Raw materials, which restates its stock and recipes).
- **The cost replaces the average only when it differs** from the one written out (to 4 decimals),
  so an export imported back leaves each average as it was, not rounded.
- **Stock on hand is neither exported nor imported:** it comes by purchases and stock counts.
- A category not on the list is added, as a raw materials or a general expenses one; one of the
  other kind is refused. "General" and "General expenses" are the built-in ones.
- Up to 2,000 rows a file and 5 MB; the Raw materials tab exports and imports the materials, the
  Expense items tab the expense items (`inventory.manage` both).

## The menu

The menu the recipes sell by and the sales name. An item's number is its code on every report:
6101, a size of it 6101-2, an add-on A3. An item is priced by itself, by its sizes, or by its
add-ons (`IsPriceBasedOnAddons`, no price of its own). A size is known by its name: one renamed is
a new size. A deleted item leaves the menu (off the lists and the new sales); its recipe and its
sales stay, and it can be restored.

Kept on the Menu page, or imported from a sheet (`GET /api/menu/template`, then `POST
/api/menu/import`): a point of sale's export with the template's columns. A row whose item number
is known changes that item; an unknown category is added; a row that cannot be read is left out
and said why, the others imported.

## Sales

A sale (`SalesReceipt`) is a bill: its day and time, its reference, how it was sold (dine in,
takeaway, delivery, online) and paid (cash, Visa, Instapay), its lines, and the discount, delivery
fee, tax, points and refund on it. Entered on Sales (a bill, or a day's totals as one) or imported
from a sheet (`GET /api/sales/template`, `POST /api/sales/import`); a sale with a reference
already recorded is not recorded again, and the import says how many were.

**Each line takes its stock by its recipe as it is recorded**, at the materials' average cost
then:

| A line | Its stock | On the reports |
| --- | --- | --- |
| On the bill | Taken (`Sale`) | Sold |
| Voided before the kitchen | Nothing | Not sold |
| Voided after the kitchen | Taken as waste (`Waste`) | The kitchen's waste |
| Refunded after payment | Taken (`Sale`), then put back (`VoidReturn`) | Not sold |

**A refund** (`POST /api/sales/{saleId}/refund`, a line and how many) splits what is handed back
off its line: its share of what was charged goes into the sale's refund, the same share as the
till's own refunds (the line's total over the bill's subtotal, of the total charged), and the
last refunded on a bill takes whatever is left of it. The cost reports count only what stayed
sold.

**A void** (`ApprovalModule.Sale`) puts back everything the sale took (each `Sale`, `Waste` and
`VoidReturn` movement reversed) and takes it out of the reports.

The theoretical cost, the variance and the KPIs read the sales from here; a month whose sales are
not entered bill by bill can be typed in item by item on Theoretical cost.

## Staff

The people the safe pays (`StaffMember`): a name and a job, kept when they leave (the safe's
entries name them) and off the lists for new advances. Their attendance and payroll are an HR
system's; here only:

- **Advances** (سلف): cash from the safe or a day's takings, to someone named or as a lump sum
  shared among the staff. Listed by month on Financials → Advances.
- **Salaries**: a month's pay paid from the safe or a day's takings, for the month it is
  (`PayrollMonth`, paid once the month has started), from Staff → Pay salary. The KPIs' labour
  cost for a month is the salaries paid for it.

## Waste and breakage

Spoilage takes materials or prep items from stock at their cost. Breakage (كسر) is something
broken (a plate, a glass): its description, how many and what each cost, and who broke it if
known; its cost counts on the day, and voiding it (on approval) takes it off.

## Financials and the tax

The safe, its funding and the day's takings are as the till kept them: the takings entered gross,
what was paid out of them taken off, the rest into the safe. The tax rate is set on Financials →
Tax & service (`FinancialSettings.TaxPercent`, a manager's): a day's takings entered with the tax
in them have it taken off at this rate, and a sale entered has it put on its bill.

## Company settings and the business day

See [company-settings.md](company-settings.md). A business day starts at the company's hour (4
by default) in its time zone: a sale at 01:30 belongs to the day before.

## The model

Schema `costing` for the system, `identity` for its users. The migrations are applied on start,
and the first start seeds the purchase categories General and General expenses, and the company's
settings from the configuration.
