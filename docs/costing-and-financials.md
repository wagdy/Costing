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
| Material & demand intelligence (تحليلات الخامات والطلبيات) | `/costing/intelligence` | Purchase price variance and what it does to the recipes, the order planner, theoretical against actual usage, ABC and days on hand; each to Excel |
| Sales (المبيعات) | `/costing/sales` | Each day's sales summary, entered or imported from its sheet, for stock and food cost |
| Purchases (المشتريات) | `/costing/purchases` | Invoices, the day's batch, suppliers, categories |
| Expense items (المصروفات العمومية) | `/costing/expense-items` | General expenses, never stock |
| Stock counts (الجرد) | `/costing/counts` | Counts drafted, then posted |
| Waste (الهالك) | `/costing/waste` | Spoilage, and breakage |
| Financials (الماليات) | `/costing/financials` | The safe, funding, each day's takings (cash, card, tax, voids), vouchers, suppliers owed and paid, advances, staff, tax and service |
| Reports (التقارير) | `/costing/reports` | Spending, theoretical cost, variance, KPIs, break-even |
| Cost settings (إعدادات التكاليف) | `/costing/settings` | Cost targets, beverage categories, shared costs, monthly expenses |
| Approvals (طلبات معلقة) | `/costing/approvals` | What waits for a manager |
| Permissions (الصلاحيات) | `/costing/permissions` | Who works which section; a manager's |

Users, Company Settings and each user's own account are in the top bar.

## Finding, sorting and entering

Every list (raw materials, recipes, prep items, the menu, invoices, expense items, stock counts and
waste) has one toolbar: an instant search by name, Arabic name or code (Arabic letter forms and
Arabic-Indic digits are read alike, and every word typed must match somewhere), filter pills for what
that list holds (category, unit, link to the menu, cost status, supplier, how paid, type, status,
reason), and a sort pill with its arrow to turn the order around. Rows with nothing to sort by (no
price yet) stay last either way.

Items, ingredients, prep items, menu items and suppliers are chosen by typing: the first letters or
the code find them, and each choice shows its code, what it is (raw material, prep item, expense,
supplier, menu item), its unit and what it costs now. Where one can be added there (a material, an
expense, a supplier on an invoice), "Add new" is offered when nothing is called what was typed.

In the line grids (an invoice's, a recipe's or prep item's ingredients, waste, a day's sales), Enter
moves from the item to its quantity to its price (on an invoice, then its discount); Enter on a
line's last field goes to the next line, or adds one, so a whole invoice can be entered without the
mouse. Enter in a grid's footer (an invoice's discount) stays there.

## Roles and permissions

Four roles. A role gives permissions (what a user may do anywhere) and the sections it works
until a manager ticks a user's own:

| Role | Permissions | Sections, until a manager ticks theirs |
| --- | --- | --- |
| Manager (مدير) | All: `inventory.view`, `inventory.manage`, `costing.view`, `approval.decide`, `users.manage`, `settings.manage` | Every section, always |
| Accountant (محاسب) | `inventory.view`, `inventory.manage`, `costing.view` | Raw materials, Material & demand intelligence, Expense items, Purchases, Financials, Sales, Reports |
| Cost Controller (مراقب تكاليف) | `inventory.view`, `inventory.manage`, `costing.view` | Raw materials, Recipes, Production, Menu, Material & demand intelligence, Sales, Stock counts, Waste, Reports, Cost settings |
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

## What a recipe is costed from

Each ingredient at its moving average cost: what was paid for a bought material, what the batches
cost for a prep item. **A prep item never made yet** (no average, or one of nothing) is costed by
its own batch recipe today instead, its theoretical cost ("by its recipe"), each of its
ingredients priced the same way, so a sauce inside a sauce is costed too (`RecipeCosts`). Once a
batch is made, what the batches cost takes over.

- Used on every recipe card, the recipes list, the menu's costs, a prep item's own standard cost,
  the import's costing, and the recipe and prep item editors as they are typed (the materials
  list carries `recipeCostPerUnit` and `costedByRecipe`). A line costed so is marked **By its
  recipe · حسب وصفته**, and the card says which prep items are not made yet.
- What has no price inside a prep item costed by its recipe is still named, through it ("Alfredo
  base: Cream"), and the recipe is still marked as missing prices; with nothing inside it priced,
  the prep item itself has no price.
- The month's theoretical cost does the same for a sale that took a prep item off the shelf
  before its first batch (at no cost then): the dish is costed now, by the prep item's cost now,
  and counted among those costed now. The KPIs' food cost by recipe reads it, so follows.
- Stock itself is never valued this way: a sale or a production order takes what is on the shelf
  at what was paid, and the variance, the stock value and the KPIs' losses stay so. A batch
  cannot be made from a prep item with no price of its own yet, as before.

## Recipes and prep items in Excel

Recipes and Prep items each have **Export Excel** and **Import Excel**, through the same import
dialog. The sheet is a row per ingredient; the export is the recipes as they are, and the template
the same sheet with no rows.

| Sheet | Columns |
| --- | --- |
| Recipes | Recipe, Ingredient, Quantity (for the whole recipe); Portions and Recipe Category on any of its rows |
| Prep Items | Prep Item, Ingredient, Quantity per Batch; Batch Makes and Kept in (Kg, Liter, Piece) on any of its rows |

- **The ingredient is chosen from a dropdown** that offers only the materials and prep items there
  are, each labelled with the unit its quantity is written in: "Flour (Kg)", "Pizza dough · مصنّع
  (Kg)". The quantity is in that unit, 0.2 for 200 g; the import converts it to the material's
  grams, millilitres or pieces. The list is a hidden sheet, **Ingredients**: every material and
  prep item with its code, its kind and its system unit. A label typed by hand is still read (by
  its name or code), but a unit in brackets that is not the material's ("Flour (g)") is refused.
- **The recipe column** offers the menu's items, sizes and add-ons by their codes ("6101 ·
  Margherita", "6101-2 · Margherita (Large)", "A3 · Extra cheese") and the recipes off the menu;
  a name of a menu item, size or add-on is linked to it, and a new name adds a recipe off the menu.
- **Grouped by name:** a recipe's rows (a blank name is the row above's) replace its whole
  ingredient list, each ingredient keeping its yield. Its portions and category change only when
  given; a new category is added. A prep item's batch, blank, stays as it was; a new one's is the
  weight of its ingredients, said so, and a new prep item is filed under مصنعات.
- **All or nothing per recipe:** one row that cannot be read (an ingredient not there, a wrong
  unit, no quantity) leaves its recipe as it was, and each such row is said why. One waiting for a
  manager, deleted, or named twice is skipped. A prep item made with another new one on the sheet
  is made after it; ones made with each other are skipped.
- **No prices on the sheet:** each recipe imported is costed from its ingredients' average costs
  now (as purchased, its yields lost): the whole recipe and one portion, or the batch and one kg,
  litre or piece. An ingredient with no price yet is named. A quantity that reads as grams
  written as kilos (over 5 kg a portion, or 200 kg a batch) is said, as is one ingredient twice
  (its quantities added together).
- **Who:** the Recipes tab (`inventory.manage`). Recipes are saved at once, as on the recipe card;
  prep items at once for a manager and asked of one for anyone else, each a request on Approvals.
- The kitchen's own batch recipes sheet (المصنعات, each prep item's name on a row of its own)
  still imports new prep items, from **Batch recipes sheet** on Prep items.

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

### Putting recipes on the menu (إضافة للمنيو)

A recipe off the menu (standalone) does not sell until it is on it. **Add to menu** on Recipes, on
one recipe's row or for all the standalone ones shown (a category or a search narrows them), puts
each on the menu in one step (`POST /api/menu/from-recipes`, the Menu tab and changing stock
records):

- **A new menu item of its name**, numbered as the next item is, at the selling price and in the
  menu category given. Each starts from the recipe's planned price and its kitchen category; one
  with no category or price waits for them, and the food cost % shows as the price is typed. A
  category not on the menu yet is added.
- **A menu item of its name there already** (not deleted, any case or spacing) with no recipe of
  its own is the one it is linked to, at its own price and category: never a second item of that
  name. One that sells by another recipe already is left alone, and said so.
- The recipe is linked to its item at once, keeping its own name, kitchen category and planned
  price. From then on it is on Sales like any item: chosen on a new sale, or imported by its name
  or code, **each sold takes its stock by the recipe** and counts on the reports.

Each recipe is checked on its own: one deleted, on the menu already, or waiting for a manager's
approval is not added and said why, in English and Arabic, and the rest are.

## Material & demand intelligence (تحليلات الخامات والطلبيات)

Under Catalog & Production, four tabs that read the stores as a cost accountant does
(`/api/costing/intelligence`, the Material & demand intelligence section and `inventory.view`).
Every quantity is in the material's purchase unit (kg, L, a carton) and every price per it. Each
tab has its summary cards on top, the list's search, filters and sort, and its Excel sheet with the
same columns (`…/sheet`).

**Purchase price variance & recipe impact (تغير أسعار الشراء وأثرها على الوصفات)**, over a period
(`GET prices?from&to`): each material bought in it, on posted invoices by the invoice's date.

- **Baseline**: the moving average the material came in with, replayed from its ledger before the
  period (each priced delivery or batch averaged in with what was on the shelf, each sale, count or
  waste at the average then). With no history, the period's first net price.
- **Latest**: the last net unit cost paid in the period (after the line's discount and its share of
  the invoice's), and who sold it.
- **Variance** = latest − baseline, and its % of the baseline. **Impact** = variance × the quantity
  bought in the period. Sorted by the impact, the largest either way first.
- **Affected recipes**: every dish and prep item the material goes into, directly or inside a prep
  item, the quantity of it in a portion (or a purchase unit of the prep item), what that portion
  costs more or less now, and against the dish's price the food cost points it moves.

**Smart order planner (مخطط الطلبيات الذكي)** (`POST orders`): `{ lookbackDays (1–90),
coverageDays (1–60), growthPercent (−90 to +500), dishes: [{ menuItemId, variantId, expectedDaily
}] }`.

- **A dish's expected sales a day**: what it sold a day in the days looked back (to yesterday), × (1
  + growth %), or as the manager sets it for that dish (or size). The days ahead need that × the
  coverage days, through the dish's recipe (its add-ons too, in the share they sold with).
- **Prep items netted first**, each before what it is made with: what is on hand of one (above its
  reorder level) is used before it is made again, and only what has to be made is broken into its
  ingredients by the prep item's batch and yield.
- **Recommended** = max(0, need for the coverage + reorder level − on hand). **Suggested**: that
  rounded up to whole purchase units. **Estimated cost** = suggested × the latest net price paid (or
  the material's cost with none). Avg daily usage: what the days looked back took a day, down to
  bought materials.
- The **approved** quantity starts at the suggested one and can be changed; the approved order goes
  to Excel (`POST orders/sheet`), grouped under each category or the supplier who sold it last, with
  each group's subtotal and the total.

**Theoretical vs actual consumption (الاستهلاك النظري مقابل الفعلي)** (`GET consumption?from&to`),
each bought material over the period, from the book's stock either side:

- **Actual** = opening + purchases − logged waste − closing. A prep item's waste counts as its
  ingredients'.
- **Theoretical** = Σ each dish sold × its recipe's gross quantity, down through the prep items; plus
  **held in prep**, the change in the prep items' stock in what they are made of (made and not sold
  yet; below zero when sales used what was made before).
- **Unexplained** = actual − theoretical; **variance cost** = unexplained × the average cost now. Its
  % of the theoretical is judged against the variance tolerance in Cost settings: over it,
  unfavourable (a high loss, the row in red); under minus it, favourable. A shared cost with nothing
  expected is not judged. Dishes sold with no recipe are listed, since they took nothing.

**ABC & days on hand (تصنيف ABC وكفاية المخزون)** (`GET abc?from&to`), each bought material that
is not archived:

- **Used**: sold, made into prep items, wasted or short at a count in the period, at the cost when it
  happened (what had no price then, at the average now). Largest first, by the running share of that
  worth: **A** while the share before it is under 75%, **B** under 90%, **C** the rest (and anything
  unused).
- **Days on hand** = on hand ÷ used a day, over the period's days so far. Under 2: **stockout
  risk**. Stock on hand with nothing used in the period: **dead or slow stock**, and the money it
  ties up at the average cost.

## Sales

Sales are entered for stock and food cost only: what each day sold, item by item, as its Z report
gives it. No bills, times, payments or tax here: the day's money is its takings (see Financials).

**A day's sales summary (ملخص المبيعات اليومية)** is the date and each item sold with how many: an
item, or each size of one sold by size, found by its code or name as it is typed (`POST
/api/sales/daily`). It is valued at the menu's prices, before tax, for the theoretical cost, the
variance and the reconciliation. An item on two rows is one line of both.

**The day's sheet** has two columns, the item (chosen from a dropdown of every menu item and size by
its code, "6101-2 · Margherita (Large)"; its code or name typed alone is found too) and the
quantity sold. The day is chosen when it is imported (`GET /api/sales/daily/template`, `POST
/api/sales/daily/import?date=`). A row that cannot be read is left out and said why, in English and
Arabic; the rest are recorded.

**One summary a day.** A second for a day already entered, by hand or by sheet, is refused, naming
it. To change a day, void it (`ApprovalModule.Sale`, a manager's or on their approval), which puts
back all the stock it took, and enter it again.

**Each item takes its stock by its recipe as it is recorded** (`Sale`), at the materials' average
cost then. A bill entered as printed (`POST /api/sales`, for scripts and older data) is still read
the same way by every report, its voids and refunds as before:

| A line | Its stock | On the reports |
| --- | --- | --- |
| On the bill | Taken (`Sale`) | Sold |
| Voided before the kitchen | Nothing | Not sold |
| Voided after the kitchen | Taken as waste (`Waste`) | The kitchen's waste |
| Refunded after payment | Taken (`Sale`), then put back (`VoidReturn`) | Not sold |

The theoretical cost, the variance and the KPIs read the sales from here; a month whose sales are
not entered day by day can be typed in item by item on Theoretical cost.

## Staff

The people the safe pays (`StaffMember`): a name and a job, kept when they leave (the safe's
entries name them) and off the lists for new advances. Their attendance and payroll are an HR
system's; here only:

- **Advances** (سلف): cash from the safe or a day's takings, to someone named or as a lump sum
  shared among the staff. Listed by month on Financials → Advances.
- **Salaries**: a month's pay paid from the safe or a day's takings, for the month it is
  (`PayrollMonth`, paid once the month has started), from Staff → Pay salary. The KPIs' labour
  cost for a month is the salaries paid for it.

## Stock counts: opening and periodic

A count is drafted (it saves itself as it is filled in, on any device) and then posted. Each count
is one of two kinds, chosen when it starts and changeable while it is a draft:

| | Opening stock (جرد افتتاحي) | Periodic count (جرد دوري) |
| --- | --- | --- |
| When | Once, when costing starts | Every week, at the same point, kitchen closed |
| Sets stock to | What was counted: where it begins | What was counted |
| In the ledger | `OpeningStock` | `CountAdjustment`: the shortage or surplus |
| Valued at | Each material's cost now; a prep item never made, its recipe's | The average cost then |
| On the KPIs and profit | Nothing | Count differences, in the cost of sales |
| Variance report | Where it can start, never where it ends | Where it starts or ends |

**The opening stock** is for starting with no purchase history: a periodic count against the zero
on the books would book the whole shelf as a surplus and inflate the month's gross profit. Posted,
it shows each material at what it was counted at, the cost it opened at and its worth, and the
total opening stock value. A material with no price has its stock set and its worth unknown until
it is priced. A prep item never made, with no cost of its own, takes its recipe's cost today as its
average from then on, as its first batch would.

**A material is opened once.** An opening count that names a material already in a posted count
(not voided) is refused, naming it: what is found from then on is a shortage or a surplus, so it is
counted periodically. A material forgotten the first time can be opened in a second opening count.
Voiding an opening count (on approval) takes its stock back out and lets its materials be opened
again.

## Purchases: discounts and the paper

A supplier's receipt is entered as written, on **New invoice** (فاتورة جديدة) or as one invoice of a
**Daily batch** (يومية المشتريات), and both take its discounts the same way:

- **A line's discount** (الخصم), beside its line total, 0 unless given: what was taken off that
  line. It needs the line's total and is never more than it.
- **The invoice's discount** (خصم الفاتورة), in the footer, 0 unless given: taken off what the
  lines come to after their own, and never more than that. It is shared among the priced lines
  by what each comes to after its own discount, to the piastre (each share rounded down, the
  piastres left one each to the lines that lost the most to rounding).
- The footer reads **Subtotal − Total discount = Net payable** (الصافي المستحق).

Everything after it uses the net, never the price before the discount: each line's AP$ per
purchase unit and the material's moving average when posted; what the safe or a day's takings
pay, and what the supplier is owed on credit; the purchases and expense reports. The invoice
keeps each line as written (its line total), its own discount and its share of the invoice's,
so it reads back, is corrected and is shown as it was on the paper. Invoices entered before
discounts read as having none.

**The paper** (إرفاق الفاتورة), a photo (JPEG, PNG, WebP) or PDF under 10 MB: on New invoice it is
attached as the invoice is entered; on a Daily batch each invoice has its own **Attach the paper**,
and the papers are sent once the batch is posted, each to its invoice, kept in the Invoices
archive as one entered alone. One that could not be sent is offered again in the posted batch
(Try again); a paper chosen is not kept by the browser if the page is reloaded before sending.

## Waste and breakage

Spoilage takes materials or prep items from stock at their cost. Breakage (كسر) is something
broken (a plate, a glass): its description, how many and what each cost, and who broke it if
known; its cost counts on the day, and voiding it (on approval) takes it off.

## Financials: takings, tax and the safe

**The safe is the one treasury.** Everything collected goes into it: the cash, the Visa and the tax
collected on them, as well as the opening balance and any funding. Everything paid goes out of it:
invoices paid in cash, supplier payments, expense vouchers, tax paid over, advances and salaries.

**A day's takings (توريد إيراد اليومية)** are entered once a day from its Z report, on Financials →
Safe → Takings in (or a day on Funding with sales and no takings yet), in this order:

| Field | Stored as | What it does |
| --- | --- | --- |
| Date (تاريخ اليومية) | `RevenueDate` | The business day the takings are of |
| Cash (إيراد الكاش) | `GrossAmount` | Cash sales before tax: revenue, into the safe |
| Visa / Card (إيراد الفيزا) | `CardAmount` | Visa sales before tax: revenue, into the safe |
| Total tax collected (إجمالي الضريبة المحصلة) | `TaxAmount` | Collected on top: into the safe, owed to the tax authority, never revenue |
| Voids & refunds (قيمة الفويد والمرتجعات) | `VoidsAmount` | Said, not taken off again (cash and Visa are after them) |
| Void reasons / notes (أسباب الفويد وملاحظات اليومية) | `Notes`, up to 500 characters | Why |

Cash or Visa must be more than nothing, and the tax no more than both. A day entered already is
refused: void that entry (it takes it back out on the day it is voided) and enter it again. The
dialog shows, as it is typed:

- **Net sales revenue (صافي إيراد المبيعات)** = Cash + Visa: the P&L's revenue.
- **Tax collected (الضريبة المحصلة)** = Tax: a liability held in the safe.
- **Total inflow into the safe (إجمالي الوارد للخزنة)** = Cash + Visa + Tax, less what was paid
  straight out of the day's takings before they were entered (invoices, suppliers, advances,
  salaries paid out of the drawer).

**Tax is never revenue and never an expense.** The P&L (Reports → KPIs, and the break-even) takes
revenue as the month's net sales, shared between food and drinks as the month's sales are at the
menu's prices; gross takings (cash + Visa + tax) and the tax are shown above it. The tax is paid
over with an **Expense voucher** marked **Tax remittance (سداد/توريد ضرائب)**: a `TaxPayment` entry,
out of the safe, which lowers the tax owed and stays off the P&L. It is listed with the expense
vouchers, marked, and kept out of their total. The dialog shows the tax held now and what it leaves.

**The Safe tab's strip** reads a month from start to finish:

1. Total cash revenue · 2. Total Visa revenue · 3. Total tax collected (with the tax held now)
4. Total in / receipts = cash + Visa + tax + funding + the balance the month opened with (its
   opening balance and external funding shown beneath)
5. Total out / payments: every payment, what the takings paid straight out of them too
6. In the safe now · 7. Closing balance = Total in − Total out

An entry voided in the month and its void are in neither; an earlier month's entry voided this
month counts here, against its own line. Each takings row in the ledger shows its Cash, Visa, Tax
and Net sales as badges (and what was paid out of it), its In what reached the safe.

**Reports → Safe & treasury (تحليل الخزنة والتدفقات النقدية)** counts any period the same way: where
the money came from (cash sales, Visa sales, tax collected, opening balance, external funding) and
where it went (supplier payments and cash purchases, operating expense vouchers by category, staff
advances and wages, tax paid over), each as a pie and a table of amounts and shares; the tax
liability reconciliation to the period's last day (collected − paid over = still owed in the safe);
and day by day, total in, total out, net cash flow, the running balance, and the voids with their
reasons. What the takings paid straight out of them is counted under what it paid for.

**Takings entered before this** had the tax inside their cash and card, and only the cash in the
safe. Migration `UnifySafeTakings` took the tax off the cash and card in proportion, so cash + Visa +
tax still add up to what was collected and the net sales are unchanged, and added each day's Visa
to what reached the safe: from then on the safe's balances, earlier months' too, include the Visa.

The tax rate on Financials → Tax & service (`FinancialSettings.TaxPercent`, a manager's) is kept for
the bills entered as printed; a day's takings carry the tax as the Z report gives it.

## Company settings and the business day

See [company-settings.md](company-settings.md). A business day starts at the company's hour (4
by default) in its time zone: a sale at 01:30 belongs to the day before.

## The model

Schema `costing` for the system, `identity` for its users. The migrations are applied on start,
and the first start seeds the purchase categories General and General expenses, and the company's
settings from the configuration.
