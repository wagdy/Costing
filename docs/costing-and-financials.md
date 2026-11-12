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
| End of the day (تقفيل اليوم) | `/costing/end-of-day` | Each day's invoices photographed, cash and on credit, and its sales report, handed in for the daily batch and the takings |
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
| Accountant (محاسب) | `inventory.view`, `inventory.manage`, `costing.view` | Raw materials, Material & demand intelligence, End of the day, Expense items, Purchases, Financials, Sales, Reports |
| Cost Controller (مراقب تكاليف) | `inventory.view`, `inventory.manage`, `costing.view` | Raw materials, Recipes, Production, Menu, Material & demand intelligence, Sales, Stock counts, Waste, Reports, Cost settings |
| Storekeeper (أمين المخزن) | `inventory.view`, `inventory.manage` | Raw materials, End of the day, Purchases, Stock counts, Waste, Production |

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

Under Catalog & Production, five tabs that read the stores and the menu as a cost accountant does
(`/api/costing/intelligence`, the Material & demand intelligence section and `inventory.view`).
Every quantity is in the material's purchase unit (kg, L, a carton) and every price per it. Each
tab has its summary cards on top, the list's search, filters and sort, and its Excel sheet with the
same columns (`…/sheet`). A card shows its title, its figure and at most a short count or share;
what the figure is and how it is worked out are in the (ⓘ) beside its title (and beside each
technical column's heading), in Arabic and English. A material's name in these tables opens its
stock card over the report's period, and the latest net price opens the invoice it came from.

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

**Menu engineering & profitability (هندسة المنيو والربحية)** (`GET menu-engineering?from&to&category`),
each dish (or size) sold in the period, as Kasavana and Smith place it:

- **Menu mix** = its quantity ÷ every analysed dish's. **Popular** when that is at least 70% of an
  even share: 70% × (100% ÷ the number of dishes).
- **Contribution margin** = its average net selling price − its food cost a portion (what its
  ingredients cost when it was sold, as the theoretical report takes it; the monthly shared costs
  are left out, so any period compares). **Profitable** when it is at least the average margin,
  weighted by what sold (Σ contribution ÷ Σ quantity).
- **Star** (النجوم): popular and profitable, keep and feature it. **Plowhorse** (خيول العمل):
  popular, below the average margin: reprice or cut its cost. **Puzzle** (الألغاز): profitable, not
  popular: promote and reposition it. **Dog** (الأصناف الضعيفة): neither: rework or remove it.
- **Suggested price** = food cost a portion ÷ the food cost target. A dish with no recipe or no price
  is listed, not placed, and its quantity is not in the mix. One menu category at a time compares
  like with like.

## The item's stock card (كارتة الصنف / حركة الصنف)

From Raw materials and Prep items (and each intelligence table): `GET
/api/costing/materials/{id}/stock-card?from&to&type` and its sheet (`…/stock-card/sheet`), on every
tab that shows a material with its stock or price. Every movement of the material over the period,
oldest first, read from the stock ledger:

- **Opening balance** = Σ movements before the first day; **total in** and **total out** = the
  period's positive and negative movements; **closing** = opening + in − out, valued at the moving
  average then. The material's current average (AP$) beside them.
- Each line: its date and time, the kind (opening, purchase, production, sales, waste, count
  adjustment) and its record, quantity in or out, the **running balance** after it, the **unit
  price** it moved at, and the **moving average after** it, replayed as the material keeps it: a
  priced delivery or batch averaged in with the stock on the shelf (none below zero), a voided one
  taken back out, any other movement carrying the average it was priced at.
- A **type filter** shows one kind of movement; the balances stay the whole ledger's.
- Each reference opens its record: an invoice over the card, the material's line marked, with the
  way to correct it (the correction voids it and posts the corrected one); a production batch; a
  stock count on its page; a day's sales on the Sales page at that day with its receipt marked
  (`?day=&receipt=`); spoilage in the waste log (`?spoilage=`). A reference opens only for a user
  who works its tab. An invoice whose paper date differs from the day it was posted shows that date.

**Price guardrail (تنبيه السعر).** On a new invoice and in the daily batch, a stock line whose net
price per purchase unit is more than 25% from the material's moving average now is marked in amber:
"تنبيه: السعر يختلف بـ X% عن المتوسط الحالي - تأكد من الوحدة!" It never stops the invoice; most such
lines are a quantity in the wrong unit.

**Yield calculator.** In a raw material's dialog, "Calculate from weight" takes the gross weight as
bought and the net usable weight after cleaning (in the same unit): yield % = net ÷ gross × 100, and
EP$ = AP$ ÷ yield; "Use this yield" puts it in the field.

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
system's. Kept here alone while HR is not linked (added on Financials → Staff, or by name from an
advance at the end of the day); while it is linked, they come from HR (see [The HR
link](#the-hr-link-ربط-الموارد-البشرية)), with HR's code and department beside them, and are
changed there. Here only:

- **Advances** (سلف): cash from the safe or a day's takings, to someone named or as a lump sum
  shared among the staff. Listed by month on Financials → Advances.
- **Salaries**: a month's pay paid from the safe or a day's takings, for the month it is
  (`PayrollMonth`, paid once the month has started), from Staff → Pay salary. The KPIs' labour
  cost for a month is the salaries paid for it, or, once HR has sent that month's payroll, the
  payroll's labor cost instead (never both).
- **Deductions** (خصومات): a till shortage (عجز خزنة) or a staff charge (خصم على الموظف) charged
  to someone on a day, on Financials → Payroll & deductions; kept here as a record and, while HR
  is linked, sent to HR as a deduction from their pay. Voided, it is taken off there too.

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

## End of the day (تقفيل اليوم)

How a branch closes its day (`/costing/end-of-day`, the End of the day section): a user given that
section alone (Permissions) sees only this page, on a phone as on a laptop. It is what the daily
batch and the takings are made from; the cash it paid out to suppliers and as advances goes to the
safe when it is submitted.

1. **The date** (تاريخ اليوم), the business day unless another is chosen; never a day to come.
2. **Cash purchase & expense invoices** (فواتير نقدية) and **credit / on-account invoices** (فواتير
   آجل), each its own section: every invoice its photo (the phone's camera or a file: JPEG, PNG,
   WebP or PDF under 10 MB, a big photo made lighter before it is sent), its supplier from the list,
   the total written on it and a short note. Each is kept as it is added (an id made by the till, so
   one sent twice is added once), and can be changed or taken off while the day is a draft. Each
   section counts its invoices and adds them up as they come.
4. **Supplier cash payments** (إذن صرف مورد وإيصال السداد): cash paid to a supplier out of the till
   against what the restaurant owes them, each with its supplier from the list, the amount, a note
   and the photo of its receipt or cash-out voucher (required). No more than the supplier is owed
   on their account, less the day's other payments to them not in the safe yet.
5. **Employee cash advances** (سلفيات الموظفين وإيصال الصرف): advances handed to staff out of the
   till, each with the employee (from Staff, those still there), the amount, a note and the photo
   of the signed receipt (required). Each is deducted from the employee's pay in the payroll month
   it is paid in, as every advance out of the safe is.
6. **The daily sales report** (ريبورت المبيعات): the drawer's **opening float** (العهدة / الفكة),
   the Z report's cash and Visa before tax, the tax on them and the voids, kept a moment after they
   are typed, and a photo of the report if there is one. Total revenue = cash + Visa + tax.

Under them, **Net cash expected in till** (الصافي الفعلي المتبقي في الكاش), worked out as the
figures are typed, to count the drawer against:

    Net cash = (opening float + cash sales with their tax)
             − (cash invoices + supplier cash payments + employee cash advances)

The Visa, Instapay and other online takings never reach the drawer, so they are not in it. The Z
report gives the tax on the cash and Visa together; the cash's share of it is in proportion (tax ×
cash ÷ (cash + Visa)), as the safe splits a day's tax. Each payment and advance, once handed in,
has its receipt with it, and the payments and advances are taken, like the cash invoices, out of
what should reach the safe.

**Review & confirm** (مراجعة وتأكيد) shows the **end of day summary report**: the cash invoices and
those on credit, the suppliers paid and the advances, each counted and added up; the sales; the
expected net cash after the cash invoices (cash − cash invoices); what should reach the safe (total
revenue − the cash invoices, the supplier payments and the advances, as the takings will show it
once all of them are out of them); and the net cash expected in the till. **Confirm & submit**
(تأكيد وإرسال التقفيل) locks the day: it needs its sales (cash or Visa), the tax no more than them.
A manager reopens a day to correct it; what is posted from it stays posted.

**Submitted, each supplier payment and advance becomes the safe's entry** (صرف من الخزنة) out of the
day's takings (out of the safe itself if they are entered already), dated the day, its id the
payment's own: a **supplier payment** (سداد مورد), off the supplier's account, or an **employee
advance** (سلفة) in the employee's payroll month. Handed in by a manager, they are entered at once;
by anyone else, each is a request for a manager on Approvals, and nothing moves until it is
approved. All of them or none: one that cannot be entered (a supplier owed less by then, an
employee who has left) refuses the day, naming it. Each shows where it is: **Waiting for a
manager**, **In the safe**, or **Refused by a manager**. One in the safe or waiting is kept as it is
when the day is reopened (corrected on Financials → Safe); one refused can be taken off and entered
again; one added after reopening goes to the safe when the day is submitted again. They are not
entered again on the daily batch.

An advance to someone on the staff who comes from HR, while the HR link is switched on, goes to
HR once it is entered in the safe (when the day is handed in, or once a manager approves it): it
waits in the HR outbox (`HrOutbox`) and is sent with its signed receipt, onto that employee's pay
there, and its void is sent the same way (see [The HR link](#the-hr-link-ربط-الموارد-البشرية)).
With HR not linked, or for someone kept here alone, an advance is deducted in this system's own
payroll month, as the safe's advances are.

**On the daily batch**, the day opens with an invoice for each one handed in and not posted yet
(Open · Daily batch from the day, or the batch's date chosen): its supplier, paid as handed in
(cash or on credit, changed per invoice there), its photo above its lines to type them from (zoom,
drag, turn, full size), and **Reported: L.E …**, the total handed in, against what the lines come
to after every discount: **Matched** (مطابق) when they agree, what is left or over until then. A
batch paid in cash can carry invoices on credit (each owed to its supplier). Posted, each is the
purchase invoice of the invoice handed in, once, with its photo as its paper; it is posted with
the day it was handed in on, and only once the day is submitted. A day not submitted yet says so.
The batch is paid, unless chosen, out of that day's takings, or on credit when every invoice is.

**The takings** (Financials → Takings in, or Takings in on the submitted day) start from the day's
sales report, until something is typed over them (Use these brings them back), and show its Z
report's photo. Entered, the day shows the takings beside it.

`/api/end-of-day`: `GET ?from&to`, `GET {date}` (204 before anything is handed in), `PUT
{date}/sales` (with `openingFloat`), `POST {date}/invoices` (a form: invoiceId, kind Cash or Credit,
supplierId, reportedTotal, note, file), `PUT|DELETE {date}/invoices/{id}`, `PUT
{date}/invoices/{id}/photo`, `POST {date}/supplier-payments` (a form: id, supplierId, amount, note,
file), `POST {date}/advances` (a form: id, employeeId, amount, note, file), `PUT|DELETE
{date}/supplier-payments/{id}` and `{date}/advances/{id}`, `PUT {date}/supplier-payments/{id}/receipt`
and `{date}/advances/{id}/receipt`, `PUT|DELETE {date}/sales-photo`, `POST {date}/submit`, `POST
{date}/reopen` (a manager's), `GET {date}/photos/{id}` (an invoice's or a receipt's by its id, the
sales report's by the day's). Written with End of the day; read with it, Purchases or Financials;
`GET /api/staff` is read with End of the day too. A batch invoice names `endOfDayInvoiceId` and
`onCredit`. Kept in `costing.EndOfDayReports` (with `OpeningFloat`), `EndOfDayInvoices`,
`EndOfDayPayouts` (migration `AddEndOfDayPayouts`) and `EndOfDayPhotos`.

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

## The POS link (ربط نقطة البيع)

A point of sale can send each shift's Z report here, and read the menu from here, over HTTP; it
never touches this database. **Settings → POS Integration** (a manager's, `SettingsManage`) holds
the link:

- **The key.** *Generate key* makes one (`cpk_` and 32 random bytes) and shows it once, to be
  pasted into the POS. Only its SHA-256 hash is kept, with its last four characters to tell it by
  (`••••w9S8`) and who made it when; it is checked in constant time. *Regenerate key* makes a new
  one and the old one stops working at once. (`GET /api/settings/pos-integration`, `POST
  /api/settings/pos-integration/key`.)
- **The sync log (سجل المزامنة).** Every call the POS makes, refused ones too: when, which call,
  what came of it (read, recorded, unchanged, updated, refused, unauthorised, failed), the
  business day and what happened, newest first, filtered to the Z reports or the problems. The key
  is never written in it.

### What the POS calls

Every call sends the key in `X-API-Key` (or `X-Pos-Node-Key`); without it, or with a wrong one,
the answer is 401 and the call is logged.

| Call | What it does |
| --- | --- |
| `GET /api/integrations/pos/ping` | The link test: `{ ok, system, company, atUtc }` |
| `GET /api/integrations/pos/menu` | The menu: categories, items by their number (6101) with price and availability, sizes by their code (6101-17), add-ons (A3) |
| `POST /api/integrations/pos/z-report` | A shift's Z report (below) |
| `POST /api/integrations/pos/events` | The POS's own event envelope (`{ id, kind, branchCode, occurredAtUtc, data }`): `day.closed` is read as a Z report; any other kind is answered 202 and left |

A Z report:

```json
{
  "zReportId": "a09d376d-…", "date": "2026-11-10", "shiftNumber": 1,
  "takings": { "totalCash": 220.0, "totalCard": 30.0, "totalTax": 35.0, "voidsAmount": 330.0,
               "voidReasons": [{ "reason": "Item quality", "count": 1, "amount": 140.0 }] },
  "soldItems": [{ "itemCode": "6101-17", "quantitySold": 1 }, { "itemCode": 9003, "quantitySold": 2 }],
  "wastedItems": [{ "itemCode": "6101-18", "quantity": 1, "reason": "Item quality" }]
}
```

`zReportId` is the POS's id for the shift, the same each time it is sent. Cash and card are
before tax, with the tax collected on them apart, as the day's takings are kept. An item is found
by its code, or a size by its code (`6101-17`); an item sold by size without one names its size
in `size`, and a line with no code is found by its `name`. `wastedItems` were made and then voided
after the kitchen.

### What a Z report makes

- **The day's sales summary** (`DailySummary`), every line placed on the menu first: one that
  cannot be (a code not on the menu, an item sold by size without its size) refuses the whole
  report, 422, naming every such line, and nothing is recorded. Each item sold takes its stock by
  its recipe (`Sale`); each wasted one is a line voided after the kitchen, its stock taken as waste
  (`Waste`), not charged. An item with no recipe is recorded and the answer warns of it.
- **The day's takings in the safe** (توريد إيراد يومية): the cash and card before tax, the tax,
  the voids and their reasons in the notes, for that business day.
- **All of it or none**: both are written in one save.
- **Sent again as it was**: nothing changes (`Unchanged`). **Sent changed** (the shift corrected
  on the POS): what it made is voided, the stock put back and the takings reversed, and the day
  made again (`Updated`).
- **A day's shifts together**: each day has one sales summary and one takings, made from all of
  that day's reports; a second shift's report remakes the day with both.
- **A day entered by hand is left alone**: if its sales summary or its takings were entered here
  by hand (or by sheet), the report is refused, 422, naming which. Void them here to let the POS's
  report in.
- A report that collides with another change at the same moment is tried again; if it still
  cannot be saved, the answer is 503 so the POS sends it again later.

The answer says what was done: `{ zReportId, date, outcome, saleId, takingsId, items, quantity,
wasted, salesValue, cash, card, tax, warnings }`.
The tables are `PosLinks` (the key's hash), `PosZReports` (each report as last received, with
its hash), `PosDays` (what the POS made of each day) and `PosSyncLogs`.

## The HR link (ربط الموارد البشرية)

The HR & Payroll system can be linked both ways, over HTTP, and only while the link is switched
on. Off (as it starts), this system works on its own: the staff are kept here, nothing is sent and
nothing is heard. **Settings → HR Integration** (a manager's, `SettingsManage`) holds it:

- **Enabled**, **HR's address** (its base URL) and **HR's key**: made on HR (Settings → Costing
  Integration) and pasted here. It is kept encrypted (AES-GCM under a key drawn from this server's
  `Auth:SigningKey`), never shown again, only its last characters; if the signing key changes it
  can no longer be read, and is pasted again. Switching on needs both. *Test connection* calls
  HR's ping.
- **This system's key for HR** (`chr_…`): made here, shown once and pasted on HR; only its SHA-256
  hash is kept. HR calls this system with it in `X-API-Key` (or `X-Costing-Key`); a wrong one,
  none, or the link off is answered 401 and logged.
- **Employees from HR**: read on *Sync employees now*, soon after switching on, and every 6 hours.
- **Waiting to be sent**: what goes to HR waits in an outbox (`HrOutbox`) and is sent every 10
  seconds, oldest first; out of reach, it is tried again from 15 seconds, doubling, up to 10
  minutes apart. Refused by HR (400, 401, 403, 404, 422), it stays refused with HR's reason until
  *Try again*. *Send now* sends what is due.
- **The sync log** (`HrSyncLogs`): every call either way, refused ones too, by direction.

### From HR

- **The employees** (`GET {hr}/api/integrations/hr/employees`: id, code, full name, department,
  branch, working or not) are kept in `SyncedEmployees`, each one a staff member here: someone of
  the same name kept here before the link becomes theirs rather than a second. Changed on HR, they
  change here; gone from HR's list or left, they are marked left. While linked, they are changed
  only on HR (refused here), none is added here, and the end of the day's advance chooses from
  them by name, code or department.
- **A month's payroll**, once a manager approves it on HR (`POST /api/integrations/hr/payroll-run`):

  ```json
  { "idempotencyKey": "…", "payrollPeriod": "2026-10", "employees": 3, "totalGrossWages": 18000,
    "totalAdditions": 0, "totalPenalties": 15680, "totalAdvancesDeducted": 250, "totalBroughtForward": 0,
    "netCashPayable": 2070, "departments": [{ "department": "Hall", "employees": 2, … }] }
  ```

  Kept as a `PayrollRun` by HR's id for it, one a month: its **labor cost** (gross + additions −
  penalties) is the month's wages on the KPIs and the profit and loss (in place of the salaries
  paid for it), and its **net cash payable** is to be paid out of the safe. The advances already
  paid out of the safe during the month are off that net cash, so none is paid twice, and they
  never count as an expense. Sent again as it was, nothing changes; sent changed while still to
  be paid, it is replaced; once paid, it is refused.
- **Financials → Payroll & deductions** lists them; *Pay out of the safe* makes one safe entry
  (`PayrollPayment`, صرف مسير رواتب) of the net cash, a manager's at once, anyone else's asked of
  a manager. Voided, it is owed again.

### To HR

Each sent with this system's id for it as its idempotency key (in the body and in
`Idempotency-Key`), so one sent again is kept once on HR, and its void sent the same way:

| Call | When |
| --- | --- |
| `POST {hr}/api/integrations/costing/employee-advance` | An advance to someone from HR is paid out of the safe (the end of the day's with its signed receipt, as base64), or voided |
| `POST {hr}/api/integrations/costing/employee-deduction` | A till shortage or staff charge is charged to them, or voided |
| `POST {hr}/api/integrations/costing/payroll-settled` | HR's payroll is paid out of the safe (its voucher, the day, who), or that payment voided |

On HR, an advance is recorded as approved on their pay, a deduction as a penalty on their pay,
and a payroll paid marks the month paid and each employee's pay owed as paid. A month whose pay
is finalized on HR refuses a void that would change it, and the outbox shows HR's reason.

## Company settings and the business day

See [company-settings.md](company-settings.md). A business day starts at the company's hour (4
by default) in its time zone: a sale at 01:30 belongs to the day before.

## The model

Schema `costing` for the system, `identity` for its users. The migrations are applied on start,
and the first start seeds the purchase categories General and General expenses, and the company's
settings from the configuration.
