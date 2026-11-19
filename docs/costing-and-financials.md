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
| Recipes (الوصفات) | `/costing/recipes` | Recipe cards, prep items (مصنعات), combo offers and recipe categories; advanced filters and the bulk material swap |
| Production (الإنتاج) | `/costing/production` | Prep items made in batches |
| Menu (قائمة الطعام) | `/costing/menu` | Categories, items, sizes, add-ons; an Excel import |
| Material & demand intelligence (تحليلات الخامات والطلبيات) | `/costing/intelligence` | Purchase price variance and what it does to the recipes, the order planner, theoretical against actual usage, ABC and days on hand, menu engineering, the fully burdened plate cost, the vendor price comparison and the inflation what-if simulator; each to Excel |
| Sales (المبيعات) | `/costing/sales` | Each day's sales summary, entered or imported from its sheet, for stock and food cost |
| End of the day (تقفيل اليوم) | `/costing/end-of-day` | Each day's invoices photographed, cash and on credit, and its sales report, handed in for the daily batch and the takings |
| Purchases (المشتريات) | `/costing/purchases` | Invoices, the day's batch, purchase orders (received with the 3-way match), suppliers (their payment terms and statements of account), categories, the vendor price comparison |
| Expense items (المصروفات العمومية) | `/costing/expense-items` | General expenses, never stock |
| Stock counts (الجرد) | `/costing/counts` | Full and spot counts drafted, blind for who counts, reconciled, then posted |
| Waste (الهالك) | `/costing/waste` | Spoilage and breakage; staff meals, hospitality and recipe tastings |
| Financials (الماليات) | `/costing/financials` | The safe, funding, each day's takings (cash, card, tax, voids), vouchers, fixed assets (CAPEX and their depreciation, also at `/costing/fixed-assets`), suppliers owed and paid, the AP aging, advances, staff, tax and service |
| Reports (التقارير) | `/costing/reports` | Spending, theoretical cost, variance, the daily break-even, KPIs (the month's P&L to EBITDA and net profit, with the discounts' margin erosion; with several branches, a branch's or the company's as a whole, consolidated), break-even |
| Cost settings (إعدادات التكاليف) | `/costing/settings` | Cost targets, plate cost (allocation method, target net margin, stand-in monthly labor and overheads), beverage categories, shared costs, monthly expenses, the daily staff meal budget |
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
| Manager (مدير) | All: `inventory.view`, `inventory.manage`, `costing.view`, `approval.decide`, `users.manage`, `settings.manage`, `settings.unlock-periods` | Every section, always |
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

- **A user kept to a branch** works in it alone, with several branches (see
  [Company structure](#company-structure-هيكلة-الشركة-الديناميكية-والمطبخ-المركزي)).

`GET /api/auth/me` gives the user's permissions, their sections (`tabs`) and the branch they are
kept to (`branchId`, null for every branch); the app shows only those. `GET /api/access` lists every user's sections and `PUT /api/access/{userId}` sets them
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
| Recipes | Recipe, Ingredient, Quantity (for the whole recipe); Portions, Recipe Category and Prep Time (mins, for one plate) on any of its rows |
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

## Advanced filters, where an item is used, and the bulk swap

**Advanced filters (فلاتر الوصفات المتقدمة).** Recipes → **Advanced filters** opens a drawer over
the list, its button counting the filters that are on:

- **Kitchen section (قسم المطبخ):** the recipe categories, the kitchen's own grouping, and
  Uncategorized. Costing has no kitchen stations of its own (those are the point of sale's printers
  and screens), so its sections are the recipe categories. A category clicked on the categories page
  opens the list here with the drawer open.
- **Contains item (يحتوي على خامة/مصنّع):** an item typed and chosen keeps the recipes that use it,
  on the recipe or inside one of its prep items at any depth, from where it is used (below).
- **Food cost above** X%, **cost a portion** from and to, and **net margin below** Y%: the true net
  margin of the fully burdened plate cost, this month so far as Cost settings share labor and
  overheads, for whoever works Material & demand intelligence. With it on, each recipe's net margin
  shows under its food cost. With nothing sold in the month yet there is nothing to share labor and
  overheads over, so no dish has one, and the drawer says so.

**Where an item is used (أين تُستخدم الخامة)** (`GET api/costing/intelligence/where-used/{materialId}`,
for every tab that opens a stock card): every recipe and prep item not deleted that uses a material
or prep item, dishes first, then prep items:

- **Per portion** (a prep item: per batch): on the recipe, as written (the edible portion ÷ the
  portions); inside its prep items, what they take of it as purchased, through every prep item
  inside, naming them. `Σ (what the portion takes of a prep item × the item in a gram of it)`.
- **Its cost** there: everything the portion takes of it, as purchased, × its cost a unit today;
  the dish's selling price, its cost a portion and food cost %, or a prep item's batch cost.
- On the stock card it is the **Linked recipes (وصفات مرتبطة)** tab beside the movements; a name
  opens the recipe card or the prep item.

**Bulk material swap (معالج الاستبدال الشامل للخامات).** **Bulk swap material** on Recipes, and on a
stock card's Linked recipes (starting from that item), walks four steps:

1. **The old item**, typed and chosen: how many recipes and prep items have it on them. One only
   inside prep items has nothing to swap itself.
2. **The new item**: any other material or prep item, with both prices.
3. **The conversion ratio (معامل التحويل):** "Replace 100 g of the old with 100 g of the new", 1:1 to
   start; lower the new quantity where the new item goes further. `new quantity = old quantity ×
   ratio`, as edible portion in each item's own unit, to the thousandth, more than 0 and at most
   1,000. Items in different units are warned about.
4. **Preview and choose** (`POST api/costing/recipes/bulk-swap/preview`, `{ fromMaterialId,
   toMaterialId, ratio, recipeIds?, prepItemIds? }`, in memory): every recipe and prep item with the
   old item on it, all ticked, with the current and new quantity, the old and new cost (a dish's a
   portion, a prep item's a batch), the **cost delta** (new − old) and the food cost % before and
   after. The dishes whose cost moves only through a prep item swapped are listed below. Unticking
   one previews again without it.

**Swap** (`POST api/costing/recipes/bulk-swap`, the same body with the ids chosen): in one
transaction, each chosen recipe's and prep item's line for the old item becomes the new item's, or
none is changed at all. Answers how many recipes and prep items were swapped.

- The new line takes the **new item's default yield** (the trimming is the new item's). A recipe that
  already has the new item takes the quantity **added to its own line**, at its yield there.
- **Nested BOMs:** costs are always worked out from the recipes as they are, so a dish made with a
  swapped prep item is costed through it. A prep item never made is costed by its recipe, so at
  once; one made already is costed by its batches, so it moves **from its next batch** (marked in
  the preview): the preview puts it at its average × (its batch with the new item ÷ its batch now).
- **Refused, and nothing changed:** the same item; the new item deleted; a recipe or prep item that no
  longer has the old item (preview again); one waiting for a manager's decision (shown locked in the
  preview); a prep item that would be made from itself (the new item is a prep item made with it);
  and prep items for anyone who may not approve. A dish's recipe is anyone's who writes recipes (the
  Recipes tab and `inventory.manage`); a prep item's recipe is a manager's, so for anyone else they
  are shown in the preview and left out.

## Combo offers (العروض والوجبات المجمعة)

Recipes → **Combos & offers** (`/costing/recipes/combos`) builds a combo from the recipes the
kitchen already has: no bill of materials is entered again. A combo (`ComboOffers`) has a **code**,
a name and Arabic name, its **selling price** and whether it is **on sale**; its dishes
(`ComboOfferItems`) are existing recipes (a menu item's, a size's, an add-on's or one off the menu),
each with how many of it one combo takes (1 to 99, each recipe once, 20 at most, two dishes at
least or two of one). Endpoints: `GET api/costing/combos` (Recipes, Menu or Reports; `nextCode`
for a new one), `PUT api/inventory/combos/{id}` and `DELETE api/inventory/combos/{id}` (Recipes and
`inventory.manage`).

```
Total combo cost        = Σ each dish's cost a portion × its quantity
Original separate price = Σ each dish's own price × its quantity   (none when a dish has no price)
Combo food cost %       = total combo cost ÷ combo selling price × 100
Savings                 = original separate price − combo selling price
```

A dish's cost a portion is its recipe card's now (moving averages, prep items by their batches,
its shared costs a meal), and its price the menu's, or a planned price off the menu. The builder
works these out as the dishes, quantities and price are typed, each total with its (ⓘ), and marks
a food cost over the target.

**Sold under its code.** The code is a menu number (as 6101 is), free when the combo is made and
kept after. Saving a combo makes or brings in line its **menu item**: the same number, name and
price, in the **Combos & offers** category (added the first time), available while the combo is
on sale (`MenuItems.ComboOfferId`). So the Sales tab, a sheet, the Z reports and a point of sale
reading the menu sell it as any item. Its name, price and availability are changed only here: the
Menu tab marks it and refuses changes, a menu sheet leaves it, and no recipe can be linked to its
number. Deleted, it leaves the list and its menu item is deleted; past sales keep it.

**Stock.** A combo sold takes no stock of its own: each dish takes its recipe's stock for the
quantity sold × how many of it the combo holds, and through its prep items what they were made
from, exactly as that many sales of the dish would (`StockRequirements`). Three "two burgers and
two lemonades" take six burgers' and six lemonades' ingredients. So the theoretical cost, the
consumption, the menu engineering and the daily break-even count a combo by its dishes, and its
menu row is costed the same way (a card with no lines of its own). A recipe in a combo cannot be
deleted until it is taken out of the combo.

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

Under Catalog & Production, tabs that read the stores and the menu as a cost accountant does
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
  to Excel (`POST orders/sheet`), grouped under each category, the supplier who sold it last, or
  the **cheapest supplier** (`groupBy: CheapestSupplier`): the one with the lowest last net price in
  the last 180 days, at that price, as the vendor price comparison finds it. Each group has its
  subtotal, and the sheet its total.
- **Create Purchase Orders · إنشاء أوامر شراء من الطلبية**, beside the Excel sheet, turns the approved
  quantities into a purchase order per supplier (`POST orders/purchase-orders`, then
  `POST api/inventory/purchase-orders/batch`): see Purchase orders below.

**Theoretical vs actual consumption (الاستهلاك النظري مقابل الفعلي)** (`GET consumption?from&to`),
each bought material over the period, from the book's stock either side:

- **Actual** = opening + purchases − logged waste − staff meals, hospitality and tastings −
  closing. A prep item's waste, and what was taken of it for staff or guests, counts as its
  ingredients'. What was taken on purpose has its own column and card (**Staff meals &
  hospitality**, beside **Logged waste**), so it is never part of the unexplained variance.
- **Theoretical** = Σ each dish sold × its recipe's gross quantity, down through the prep items; plus
  **held in prep**, the change in the prep items' stock in what they are made of (made and not sold
  yet; below zero when sales used what was made before).
- **Unexplained** = actual − theoretical; **variance cost** = unexplained × the average cost now. Its
  % of the theoretical is judged against the variance tolerance in Cost settings: over it,
  unfavourable (a high loss, the row in red); under minus it, favourable. A shared cost with nothing
  expected is not judged. Dishes sold with no recipe are listed, since they took nothing.

**Station variance (انحراف الأقسام)** (`GET /api/costing/intelligence/station-variance?from&to`,
for whoever works Material & demand intelligence or Reports; also Reports → Station variance): the
same consumption, each material held against the kitchen or bar station that keeps it (see [Kitchen
and bar stations](#kitchen-and-bar-stations-أقسام-التشغيل-والمطبخ)). A material with no station, or
one whose station was taken away, is the shared station's (a shared group of its own when there is
no shared station). For each station over the period:

| Figure | How it is worked out |
| --- | --- |
| Theoretical cost (التكلفة النظرية) | Σ its materials' theoretical usage (with what is held in prep) × the average cost now |
| Actual cost (التكلفة الفعلية) | Σ (opening + purchases − logged waste − staff meals & hospitality − closing) × the average cost now |
| Unexplained variance (الانحراف غير المبرر) | actual − theoretical, in money, and its % of the theoretical (none when nothing should have been used) |
| Logged waste (الهالك المسجل) | spoilage logged and dishes voided after the kitchen, less refunds put back, at the cost then, held against the **station responsible** for each entry (not always the material's own) |
| Top 3 losing materials | its three materials with the highest unfavourable variance cost |
| Status | **Within target** (منضبط) up to three quarters of its tolerance; **Watch** (تحت المراقبة) above that; **High loss** (عجز مرتفع) past it; with nothing expected and something used, high loss |

The tolerance is the station's own when it has one, the costing settings' otherwise. Shared costs
with nothing expected (as on the consumption report) are listed but not judged. The quantities are
per material, in its purchase unit: a station's materials are in different units, so a station is
summed in money only.

The page shows a **scorecard a station** (its status badge, theoretical against actual, the
unexplained in money and %, colour-coded, its logged waste, its tolerance and its three leaking
materials as pills); **a bar a station** of its unexplained % against its own tolerance line (green,
amber or red, the value beside it); and **each material** (station, material, opening, purchases,
logged waste, closing, actual, theoretical, unexplained quantity, variance cost, variance % and
evaluation). Clicking a scorecard or a bar lists that station's materials (again: every station's),
and a material's name opens its stock card over the period, to its invoices, waste and counts. Each
figure and technical column has its (ⓘ). **Export station variance** (`…/station-variance/sheet`)
writes a **Station Summary** sheet (a row a station and the total) and a **By Station** sheet (each
station's materials under its heading, its total and status under them).

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

**Vendor price comparison (مصفوفة مقارنة أسعار الموردين)** (`GET api/costing/intelligence/vendor-prices?from&to`,
and `…/sheet`; for Material & demand intelligence or Purchases, a tab in each; the last quarter
unless set), each material bought on posted invoices in the period and every supplier who sold it:

- Per purchase unit, net of the line's discount and its share of the invoice's: the **last net
  price** and when, the **lowest** and **highest**, the **weighted average** (Σ net paid ÷ Σ
  quantity) and the **quantity** bought, with how many purchases.
- Suppliers are listed cheapest last price first, and where there is more than one the cheapest
  is marked **Best price** (الأقل سعراً) and the material shows the **spread**, how much dearer the
  dearest last price is than the cheapest, in %. A filter keeps only the materials with a choice.
- The order planner's **Cheapest supplier** grouping sends each material to that supplier.

## The fully burdened plate cost (التكلفة الكلية للطبق)

Food cost alone flatters a dish: a plate also takes the kitchen's time and its share of the rent,
the utilities and the depreciation. The **Burdened plate cost** tab of Material & demand
intelligence (`/costing/intelligence/burdened`, `GET api/costing/intelligence/burdened-costs?from&to&method&source&monthlyLabor&monthlyOverhead`,
and `…/sheet` for Excel) shares the period's labor and overheads over every dish, and shows what is
truly left of each price. It is linked from Recipes and from the KPIs' item profitability, and each
recipe card shows its own plate (`GET api/costing/recipes/{id}/burdened`: this month so far, as Cost
settings share it).

```
Fully burdened cost  = food cost + allocated labor + allocated overheads
Prime cost           = food cost + allocated labor
True net profit      = selling price (before VAT) − fully burdened cost
True net margin %    = true net profit ÷ selling price × 100
Period net profit    = true net profit × plates sold
```

**Food cost** is the recipe card's cost per portion now: each material's moving average, prep items
by their batches (by their own recipe before the first), and the shared costs.

**The pools.** Each month is taken whole and spread evenly over its days, so a rent voucher paid on
the 1st, or a payroll approved on the 30th, is carried by every plate of its month, and part of a
month carries its share by days (16 of 30 days: 16/30).

| Pool | A month's amount |
| --- | --- |
| Labor (إجمالي وعاء العمالة) | The payroll HR approved for it (its labor cost), or the salaries paid from the safe for it when HR sent none; the wages and benefits entered on the KPIs; expense invoices and vouchers under a Wages category; the staff meals logged in it, at their cost |
| Overheads (وعاء الإيجار والمرافق والتشغيل) | The occupation (rent), controllable costs, interest and depreciation entered on the KPIs; the fixed assets register's depreciation for the month; expense invoices and vouchers under an Occupation, Controllable or Other fixed category; the hospitality and recipe tastings logged in it, at their cost |

A month with nothing recorded for a pool takes the **stand-in monthly figure** from Cost settings
(Plate cost), when one is set, and the screen names the months that did. **Simulate monthly labor
& overhead** replaces the pools with monthly figures typed on the screen (blank: the stand-in
figures), spread the same way, to test the plates before a month's payroll and bills are in.

Costing has no prepaid-expense schedule or card-commission record of its own (staff meals and
hospitality are logged under Waste, below): depreciation is the fixed assets register's for the
month (Financials → Fixed assets, below), with any entered for the month on the KPIs; a prepaid rent is
amortised by entering the month's share as its occupation cost (a voucher counts in the month it is
dated); bank and card charges are expense vouchers or invoices under a Controllable category.

**Sharing them** (طريقة التحميل), over the plates sold in the period:

| Method | Labor a plate | Overheads a plate |
| --- | --- | --- |
| Activity-based (prep time) · حسب وقت التحضير (ABC) | labor pool × its weighted minutes ÷ Σ (plates sold × weighted minutes) | overhead pool ÷ plates sold |
| Equal per plate · بالتساوي حسب الكمية المباعة | labor pool ÷ plates sold | overhead pool ÷ plates sold |
| By revenue % · بنسبة المساهمة في الإيراد | labor pool × its price ÷ the period's sales (its share = price × quantity ÷ sales, over its quantity) | overhead pool × its price ÷ the period's sales |

Shared over what was sold, the pools are allocated whole: Σ (a plate's share × its quantity) is the
pool. A dish not sold in the period (on the menu, or a recipe off it at its planned price) is given
what a plate of it would have carried at the same rates, marked estimated. With nothing sold at all
there is nothing to share over, and each dish says so.

**Weighted minutes** (معامل وقت وصعوبة التحضير): each recipe has a **prep time** for one plate (minutes,
0 to 1,440; blank is the ordinary 10) and a **complexity weight** (1 an ordinary minute; 0.1 to 10).
A prep item has the same for one batch. A plate's weighted minutes are its own prep time ×
complexity, plus, for each prep item it is made with, what it takes of a batch (as purchased) ÷ what
the batch makes × the batch's weighted minutes; a pizza with 250 g of a 10 kg dough batch that takes
60 minutes carries 1.5 of them. Recipes and prep items written before this start at 10 minutes.

**The suggested price** leaves the target net margin (Cost settings, 15% unless set) after
everything. Equal or activity-based, a plate's labor and overheads do not move with its price:
`fully burdened cost ÷ (1 − target)`. By revenue they do, at the pools' share of every pound sold:
`food cost ÷ (1 − target − (labor pool + overhead pool) ÷ sales)`, and there is none when the pools
take as much as the margin leaves.

**Each dish's status:** *Healthy net margin* (ربح صافي جيد) at or above the target; *Thin margin*
(هامش ضعيف) profitable, below it; *Losing after overhead* (خاسر بعد التحميل) below zero. **Dishes
bleeding after overhead** (أطباق خاسرة بعد تحميل المصاريف) are those above their food cost (price −
food > 0) that lose money once labor and overheads are added.

**The summary:** the labor and overheads the plates sold carried, and on average a plate; the
average fully burdened cost % and true net margin %, weighted by sales (Σ burdened × plates ÷ Σ price
× plates); and the dishes bleeding. Each dish's bar shows its price as food (blue), labor (amber),
overheads (purple) and net profit (green); a loss is the part of the costs past the price, hatched
red behind a price mark. The Excel sheet has the dishes and the pools with their parts.

## The daily break-even (نقطة التعادل اليومية)

Reports → **Daily break-even** (`/costing/reports/daily-break-even`, `GET api/costing/reports/daily-break-even?date`,
today when no date) sets one day's sales against its share of the month's fixed costs, at the
margin of what that day actually sold, instead of waiting for the month's P&L.

```
Daily fixed cost      = the month's fixed costs ÷ the days in the month
Net sales             = the day's sales at the menu's prices, less each bill's discount, before VAT
Food cost             = Σ plates sold × their recipe cost a portion today (add-ons too)
Contribution margin   = net sales − food cost
WACM %                = contribution margin ÷ net sales × 100
Break-even sales      = daily fixed cost ÷ WACM
Operating result      = contribution margin − daily fixed cost
```

- **The month's fixed costs** are the burdened plate cost's two pools for the whole month: labor
  (the payroll HR approved, or the salaries paid for the month; the wages entered; expenses under a
  Wages category) and overheads (rent, controllable costs, interest and depreciation entered on the
  KPIs; the fixed assets register's depreciation; expense invoices and vouchers under an Occupation, Controllable or Other fixed category). A
  month with nothing recorded for a pool takes its **stand-in monthly figure** from Cost settings
  (Plate cost), so a day early in a month still has a target.
- **WACM** is weighted by the day's own menu mix: selling more dishes with a high margin lowers the
  target. A day with no sales yet takes the WACM of the seven days before it, and says so; with no
  sales in those either there is no target, and the day's fixed costs are its loss.
- The food cost is at today's costs (each material's moving average, prep items by their batches),
  for any day looked at. A plate sold with no recipe adds its sales and no food cost, and is said.
- The screen says it in a sentence (Arabic and English: what the day must sell, what it sold, and
  the operating profit in green or loss in red), draws the sales from 0 against the break-even line
  (amber until it is crossed, then green), and shows the daily fixed costs, the WACM, the net sales
  and the food cost, with the month's fixed costs by part. Earlier days can be looked back at.

## The inflation what-if simulator (محاكي التضخم والتسعير)

Material & demand intelligence → **Inflation simulator** (`/costing/intelligence/inflation`,
`POST api/costing/intelligence/simulate-inflation`, and `…/sheet` for Excel) costs every dish,
off-menu recipe and prep item again at prices that have not happened yet, in memory: nothing is
saved, and no average, recipe or price changes.

```
{ "globalPercent": 10,
  "categories": [{ "categoryId": "…", "percent": 25 }],
  "materials":  [{ "rawMaterialId": "…", "costPerPurchaseUnit": 180 }] }
```

- **The rules.** A bought material's price changes by the most specific rule given, never two at
  once: its own new price (per purchase unit) > its category's % > the global % > as it is. A
  percentage is from −90% to +1,000%; a new price is never below zero.
- **Prep items carry it through.** One never made is costed by its recipe at the new prices; one
  made, at its average × (its batch at the new prices ÷ its batch now), so a prep item inside a
  prep item moves with what it is made of.
- **Each dish:** its cost a portion now and at the new prices, the change, its food cost % now and
  then, flagged when the simulated % is over the food cost target (and newly so). Two suggested
  prices: **keep the food cost %** = price × simulated cost ÷ current cost; **keep the cash margin**
  = price + (simulated cost − current cost). **Monthly profit impact** = (current cost − simulated
  cost) × plates sold in the last 30 days: what the month would lose at today's prices.
- Off-menu recipes show the same against their planned price, with no sales to weigh; prep items
  their cost per display unit (kg, L). The materials changed are listed with their price now and
  simulated, and the Excel sheet has both.
- The screen recalculates as the sliders and rules change (a global slider, a % per category, a new
  price per material), with the dishes over target counted, and the totals and each column's (ⓘ).

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
- **Linked recipes (وصفات مرتبطة):** a tab beside the movements, where the item is used (see the bulk
  swap), with the swap button for whoever writes recipes.
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

**The sales sheet** (`GET /api/sales/daily/template`) has a row for each item sold: its **Date ·
تاريخ المبيعات** (dd/MM/yyyy, or an Excel date), the item (chosen from a dropdown of every menu item
and size by its code, "6101-2 · Margherita (Large)"; its code or name typed alone is found too) and
the quantity sold. A day's **discounts** (الخصومات) go on rows of their own (or beside an item): the
Date, the **Discount Amount**, its **Discount Reason** and the **Discounted Bills**; a day's amounts
are added up, and its reasons by name (capitals and spaces aside), as the summary's `DiscountAmount`
and `DiscountReasons`, never more than the day's items come to at the menu's prices. Headings are
found by name, in English or Arabic, in any order. A row that cannot be read is left out and said
why, in English and Arabic; the rest are recorded.

On Sales → **Import sales · استيراد المبيعات** (with its (ⓘ): *You can now upload multiple days at
once. Make sure to add the 'Date' column in the template and ensure no days are skipped!*), two ways:

- **One day · يوم واحد**: the day chosen in the dialog, its sheet's Date left blank or that day
  (`POST /api/sales/daily/import?date=`). A sheet with rows of other days is refused: it is a
  multi-day sheet.
- **Multi-day Excel upload · عدة أيام** (استيراد مبيعات متعدد الأيام): no day to choose; the rows are
  grouped by their Date and the days taken **oldest first**. Chosen, the sheet is **previewed**
  (`POST /api/costing/sales/bulk-import-pos/preview`), nothing recorded: each day with its items, how
  many sold, its value at the menu's prices, its discounts and its rows left out, and either *Found 3
  days in file: 15/11 (9 items, 45 sold), 16/11 (…), 17/11 (…). This matches your next expected
  sequence. Proceed? · تم العثور على 3 أيام، وهي مطابقة لتسلسل النظام. هل تود الاستمرار؟* or, in red,
  what stops it. **Proceed** records it (`POST /api/costing/sales/bulk-import-pos`).

The multi-day sheet keeps the end of day's order ([Strict sequentiality](#strict-sequentiality-and-the-managers-undo-التسلسل-الزمني-وإلغاء-التقفيل)):

1. **Every row has its day**: a row without a Date refuses the sheet, naming the rows.
2. **It starts on the next day to import**: the day after the last closed day, past any day whose
   sales are in already (`expectedFirstDate`). Starting later is *Missing day 15/11/2026 in the
   sequence: the file starts on 16/11/2026…*. With no day closed yet, any day up to today starts it.
3. **No day skipped**: between two of its days, a day whose sales are not in is *Missing day
   16/11/2026 in the sequence. Please include it in the file or mark it as a Closed Day first. · يوم
   16/11/2026 مفقود من التسلسل، يرجى إضافته أو إغلاقه كيوم إجازة أولاً.*
4. **None to come, none closed, none entered already**: a day after today, on or before the last
   closed day, or whose sales are in already, is named.
5. Each day must have an item that can be read, and its discounts no more than its items' value;
   at most 31 days and 20,000 rows a sheet.

Recorded, it is **every day or none**, in one unit of work: oldest first, each day's sales summary
(`SalesSource.DailySummary`, its stock taken by its recipes, a combo by its dishes' recipes, as any
sale: at the materials' moving average when recorded, which sales never move), and, for each day
whose end of day is not started, an **empty end-of-day draft**, to be handed in in turn (its sales
report, invoices and payments entered there). Such an empty draft dated after the day to close next
is waiting its turn, not stranded: only a draft with something on it is offered to be moved
(`strandedDrafts`). The answer gives each day's `saleId` and `draftsCreated`; a refused sheet is a
422 naming the first three problems.

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

## Kitchen and bar stations (أقسام التشغيل والمطبخ)

Each material, prep item and dish is kept by a **kitchen or bar station** (`costing.KitchenStations`:
name, Arabic name, code, display order, its own variance tolerance or none, in use or not), so its use
and its waste are held against that section of the kitchen. Seven come with the migration
(`AddKitchenStations`), once: Grill · المشويات, Pizza & Bakery · البيتزا والمخبوزات, Hot Kitchen ·
المطبخ الساخن, Cold & Salads · المقبلات والسلطات, Bar & Barista · البار والباريستا, Pastry & Desserts ·
الحلويات and Shared / General · خامات مشتركة (code `SHARED`); a manager changes or takes each away
on **Cost settings** (`GET /api/costing/stations`, `PUT|DELETE /api/costing/stations/{id}`, a
manager's), and they are not added back. A code is unique; a name too.

- **Materials and prep items** (`RawMaterials.KitchenStationId`): on Raw materials and Prep items a
  **Station** column with its picker in each row, and a **Station** filter pill; on Raw materials,
  **Station for the N shown** gives every material the filters show one station at once (`PUT
  /api/inventory/raw-materials/station` with `rawMaterialIds` and `stationId`; null: none). The raw
  materials sheet has a **Station · القسم التشغيلي** column (exported by name; imported by name,
  Arabic name or code; blank leaves it as it is; one not in use skips the row, said why).
- **Dishes** (`Recipes.KitchenStationId`): on the recipe card (`PUT /api/inventory/recipes/{id}/station`).
  A plate voided after the kitchen made it is that station's waste.
- **Waste** (`StockMovements.ResponsibleStationId`): each spoilage line on Waste has a **Station
  responsible · القسم المسؤول**, the material's own until another is chosen (the hot kitchen that
  spoiled a shared item); the recent entries show and filter by it. A void of an entry keeps its
  station, so the two net out.
- A station **not in use** is off the pickers and given nothing new; its history stays. **Taken
  away**, what it kept (materials, prep items, dishes, waste) falls to the shared station.

## Stock counts: opening, periodic, spot and blind

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

### Full and spot counts (جرد شامل · جرد يومي سريع / جزئي)

A count covers either every material and prep item (**Full count**, جرد شامل: the weekly or month-end
count) or a short list (**Spot count**, جرد يومي سريع / جزئي: a few items, checked every day to catch a
loss early). A spot count is started in one click from a ready list on the Stock counts page, each
showing how many it covers:

| List | What it covers |
| --- | --- |
| Daily critical items (أصناف الجرد اليومي المحددة) | Every material and prep item starred (☆) on Raw materials or Prep items |
| Top class-A materials (أصناف الفئة A الأعلى قيمة) | Class A of the ABC analysis over the last 30 days |
| High-variance materials (الأصناف الأكثر انحرافًا) | Over their recipes in the last 30 days, or short beyond the tolerance at the last periodic count |
| By category (حسب الفئة) | Every material of one category |
| By station (حسب قسم المطبخ) | Every material and prep item of one kitchen or bar station (none: the shared station's), for a count at its shift's close |

On a count's sheet, full or spot, **By station · حسب قسم المطبخ** shows one station's materials
alone, and **Print blind sheet** then prints that station's, its name in the title.

The star is a flag alone (no stock moves, so no approval), set by whoever manages the materials.
**Posting a spot count adjusts only the lines counted**: a material not on it, or on it and left
blank, keeps its stock, and no `CountAdjustment` is written for it. Its sheet lists only what it
covers. Both are periodic counts in the ledger and on the reports.

### Blind counts (الجرد الأعمى)

Whoever counts sees only the code, name, category and unit of each item, a field for what is on the
shelf and an optional note: never what the records expect (the book), the variance or the cost, so
the count is what is on the shelf and not what the screen says. It is enforced for whoever does not
see the costs (a Storekeeper, no `costing.view`): the API leaves the book and the costs out of every
draft it answers them with, whatever is asked. A Manager, Cost Controller or Accountant may count
blind too: **Blind entry mode** (وضع الجرد الأعمى) on the count sheet, then asking `?blind=true`.
**Print blind sheet** (طباعة كشف جرد أعمى) prints the sheet to count on paper: code, material,
category, unit, an empty box for each, and lines to sign.

A blind counter **hands the count in for review** (تسليم للمراجعة); only who sees the costs posts it.
They reconcile it on the count sheet (also reached from Approvals, while one waits): each line's
book, what was counted, the variance in its unit, the unit cost and the variance value, the largest
first, a line short beyond the variance tolerance marked red and one over it amber, and the net
variance. **Recount needed** (مطلوب إعادة جرد) sends the picked lines back with a note: the counter
sees them marked to weigh again, still without the book, and hands the count in again. Posting
clears the recount marks; the count keeps who handed it in.

## End of the day (تقفيل اليوم)

How a branch closes its day (`/costing/end-of-day`, the End of the day section): a user given that
section alone (Permissions) sees only this page, on a phone as on a laptop. It is what the daily
batch and the takings are made from; the cash it paid out to suppliers and as advances goes to the
safe when it is submitted. With several branches, each closes its own days (below, *Each branch's
day*): the page is the branch worked in's, named at its top.

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
   the Z report's cash and Visa before tax, the tax on them and the voids, the **discounts &
   promos** (الخصومات والعروض) with why (each reason and what it took off: loyalty, staff, a
   manager's promo; their amounts no more than the discounts), kept a moment after they are typed,
   and a photo of the report if there is one. Total revenue = cash + Visa + tax.

Under them, **Net cash expected in till** (الصافي الفعلي المتبقي في الكاش), worked out as the
figures are typed, to count the drawer against:

    Net cash = (opening float + cash sales with their tax)
             − (cash invoices + supplier cash payments + employee cash advances)

The Visa, Instapay and other online takings never reach the drawer, so they are not in it; nor
are the discounts: they were taken off before the money was collected, the cash is after them,
and the till card says so when there are any. The Z
report gives the tax on the cash and Visa together; the cash's share of it is in proportion (tax ×
cash ÷ (cash + Visa)), as the safe splits a day's tax. Each payment and advance, once handed in,
has its receipt with it, and the payments and advances are taken, like the cash invoices, out of
what should reach the safe.

**Review & confirm** (مراجعة وتأكيد) shows the **end of day summary report**: the cash invoices and
those on credit, the suppliers paid and the advances, each counted and added up; the sales; the
expected net cash after the cash invoices (cash − cash invoices); what should reach the safe (total
revenue − the cash invoices, the supplier payments and the advances, as the takings will show it
once all of them are out of them); and the net cash expected in the till. **Confirm & submit**
(تأكيد وإرسال التقفيل) locks the day: it needs its sales (cash or Visa), the tax no more than them,
or to be confirmed as a day that sold nothing. Days are closed one after another, and a manager
corrects the last one closed by undoing it (see [Strict sequentiality and the manager's
undo](#strict-sequentiality-and-the-managers-undo-التسلسل-الزمني-وإلغاء-التقفيل)).

**Submitted, each supplier payment and advance becomes the safe's entry** (صرف من الخزنة) out of the
day's takings (out of the safe itself if they are entered already), dated the day, under the
payment's voucher id (the payment's own id at first, a new one each time the day is undone, so it
is entered again when the day is handed in again): a **supplier payment** (سداد مورد), off the supplier's account, or an **employee
advance** (سلفة) in the employee's payroll month. Handed in by a manager, they are entered at once;
by anyone else, each is a request for a manager on Approvals, and nothing moves until it is
approved. All of them or none: one that cannot be entered (a supplier owed less by then, an
employee who has left) refuses the day, naming it. Each shows where it is: **Waiting for a
manager**, **In the safe**, or **Refused by a manager**. When a manager undoes the day, one in the
safe is voided and one waiting is refused: each is the day's again, to change or take off, and
goes to the safe again when the day is handed in again. They are not entered again on the daily
batch.

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
and `{date}/advances/{id}/receipt`, `PUT|DELETE {date}/sales-photo`, `POST {date}/submit` (body
`{ "zeroSales": true }` for a day that sold nothing; the answer's `warnings` say what to look at),
`GET sequence`, `POST void-last` (also `POST /api/costing/end-of-day/void-last`; a manager's), `POST
mark-closed-day` and `POST {id}/reassign-date` (also under `/api/costing/end-of-day/`; the second a
manager's), `POST {date}/reopen` (the same undo, of that day only when it is the last closed), `GET {date}/photos/{id}`
(an invoice's or a receipt's by its id, the sales report's by the day's). Written with End of the
day; read with it, Purchases or Financials; `GET /api/staff` is read with End of the day too. A
batch invoice names `endOfDayInvoiceId` and `onCredit`. Kept in `costing.EndOfDayReports` (with
`OpeningFloat`, `ReopenReason`, `IsClosedDay`, `ClosedDayReason`, `AuditTrail`), `EndOfDayInvoices`,
`EndOfDayPayouts` (with `VoucherId`; migrations `AddEndOfDayPayouts`, `AddEndOfDaySequence`,
`AddEndOfDayClosedDaysAndAudit`) and `EndOfDayPhotos`; the books' lock in
`costing.CompanySettings.BooksLockedUntilDate` (see [Period lock and month-end close](#period-lock-and-month-end-close-إقفال-الفترة-المحاسبية-وتجميد-الدفاتر)).

### Strict sequentiality and the manager's undo (التسلسل الزمني وإلغاء التقفيل)

Days are closed in exact order, so the safe, the stock and the reports never have a day missing
between two closed ones. A day is **closed** once its end of day is submitted; the **last closed
day** (`LastClosedDate`) is the latest submitted, and the **next expected day**
(`NextExpectedDate`) the day after it.

- **Rule 1, in order:** a day is handed in only when it is the day after the last closed day. One
  before it, or the last closed day again, is refused (*closed already, or before the last closed
  day*); one after it is refused naming the day to close first (*Close Tue 3 Nov 2026 first*).
  Before any day is closed, any day up to today starts the sequence.
- **Rule 2, never ahead:** no day after today (the business day, as the till keeps it) is opened
  or handed in (*That day has not come yet*).
- **The books' lock:** no day on or before the date the books are closed until
  (`BooksLockedUntilDate`, إقفال الدفاتر) is closed, changed or undone: refused 423 Locked. A
  manager closes them on **Settings → Period lock**, up to the last closed day at the latest and
  never past today; Reports → Daily summaries shows how far, with a link there.
- **No entries out of order:** an invoice, payment, sales report or photo makes a new day only for
  the next expected day; a draft made before the rules came in can still be changed, but is handed
  in only in its turn.
- **A day that sold nothing** (يوم بدون مبيعات) is still closed, to keep the order: Review &
  confirm asks *No POS sales found for this date. Are you sure you want to close this as a
  Zero-Sales day to maintain the sequence?*, and only once confirmed is it handed in with
  `zeroSales`. Refused when the day does have sales: a sales summary (from the POS or entered by
  hand) or takings in the safe for it.
- **Before closing, never stopping it** (`warnings`, on `GET sequence` for the next day and on the
  submit's answer): purchase invoices left as drafts dated on or before the day (*There are draft
  invoices … Consider posting them before closing the day*), and cash handed out with no one
  named (a pending advance, an open cash custody) more than 48 hours ago, in the last 30 days
  (*settle them by giving them out on HR → Advances, or void them*). This system sees the
  advance itself, not HR's allocations of it, so one given out on HR but not voided here is still
  said.

**On End of the day**, the date is locked to the next expected day once a day is closed (a lock
on the date field), with the banner *The last closed day was Mon 2 Nov 2026. You are currently
closing Tue 3 Nov 2026. You must close days in exact order.* and its Arabic (آخر يوم تم إغلاقه هو
…، يجب إغلاق يوم … أولاً). A day opened from Recent days is read as it is; one out of order cannot
be reviewed (*Close … first*) and **Go to** returns to the day to close. With every day closed up
to today the page shows the last one, and Review & confirm is disabled with *All days are closed
up to today. Come back tomorrow.* (تم تقفيل جميع الأيام حتى تاريخ اليوم). The warnings are shown
above the submit bar and in the summary report.

**The manager's undo** (إلغاء وفتح اليوم), only of the last closed day, so the days before it stay
as they are, and never of one in the books locked: **Undo & Reopen Day** on Reports → **Daily
summaries** (`/costing/reports/daily-summaries`: every day handed in over a period, latest first,
the button on the last closed row alone, for a manager) or on the submitted day on End of the
day. It asks, as a danger, *Are you sure? This will reverse the cash taking and POS integration
for this day so it can be recorded again correctly.*, listing what it reverses, and takes a reason
(kept on the day, shown as *undone by …: why*). Then, in one unit, dated today:

1. **The takings** in the safe for the day are voided. What was paid out of the day's takings
   before they went in goes back to the day's drawer, not the safe.
2. **The sales summary** of the day, entered by hand or made from the POS's Z reports, is voided,
   its stock put back. The POS's mapping of the day is cleared, and each of its Z reports is taken
   again when the POS sends it again (the same report is no longer a resend).
3. **The purchase invoices posted from the invoices handed in** (a correction's, if one was
   corrected since) are voided, their stock, costs, cash and supplier's account undone, and
   unlinked from the day, to be posted again on the daily batch.
4. **Its payments and advances** in the safe are voided (owed again to the supplier, off the
   employee's pay again); those still waiting for a manager are refused (*The end of day was
   undone*).
5. **The day** becomes a draft, the next expected day again.

Refused while one of them waits for a manager on Approvals. `POST void-last` takes `date` (the day
the manager saw: refused if another was closed since) and `reason`; the answer is the day and what
was reversed (`takingsVoided`, `salesVoided`, `invoicesVoided`, `payoutsVoided`, `requestsRefused`,
`zReports`). `GET sequence` gives `lastClosedDate`, `nextExpectedDate`, `today`, `allClosed`,
`booksLockedUntil`, `warnings` and `lastClosed`, what undoing it would reverse (its takings, sales
items, posted invoices, payments in the safe, Z reports, and whether the books are locked over it).

### Closed days and stranded drafts (يوم مغلق، والمسودة العالقة)

Two ways through the order without breaking it.

**A day the restaurant did not trade** (تسجيل يوم إغلاق أو صيانة): closed for maintenance, a holiday,
a power cut. On the blank page of the day to close next, **Mark as Closed/Off Day · تسجيل كيوم
مغلق** asks why (required, up to 300 characters, e.g. *Restaurant closed for plumbing
maintenance*) and closes it as a submitted day with nothing on it (`IsClosedDay`,
`ClosedDayReason`): no sales report, no Z report, nothing to post or take in. The next day is then
the one to close, and the page opens on it. A closed day is shown as **Closed day · يوم مغلق** with
its reason on End of the day, Recent days and Daily summaries, and is undone like any day (the last
closed, by a manager), becoming an ordinary draft again.

- Only the day to close next (the same order rules: never a day to come, never in the books
  locked); anyone who works End of the day.
- Not a day with anything handed in (an invoice, a payment, a sales figure or the Z photo): that
  is handed in with it. An empty draft left on the day is closed as it is.
- Not a day the restaurant sold on: a sales summary (from the POS or by hand) or takings in the safe
  for it refuse it (*hand the day in with its sales instead*). It needs no sales report, but a
  closed day with sales in the books would hide them from the end of day.
- `POST /api/costing/end-of-day/mark-closed-day` with `{ "targetDate", "reason" }`; the answer is the
  day, with the `warnings` a submit gives.

**A draft entered under the wrong date** (ترحيل المسودة العالقة): the day's invoices typed on the
17th while the 16th is still to close. Such a draft (from before the order rules, or made before
any day was closed) can never be handed in where it is. `GET sequence` lists them
(`strandedDrafts`: each draft dated after the day to close next with something on it, with its
invoices, payments and whether it has sales; an empty one, as a multi-day sales import makes them,
waits its turn); the page of the day to close next points to each (*A draft dated Tue 17 Nov
holds 3 invoices…: Open it*), and the draft itself shows a warning banner with **Migrate Data to
Mon 16 Nov · نقل البيانات وإصلاح التاريخ** for a manager (anyone else is told a manager moves it).
It asks the **reason for the change (required)** (سبب التعديل الإجباري), then, in one unit:

1. The draft takes the date of the day to close next, everything on it with it: its invoices,
   payments, sales report, notes and photos (kept by their own ids).
2. The draft purchase invoices paid out of its day's takings (`DayRevenue`, that takings day) move
   too: their takings day, and their date when it was the draft's. Others (paid from the safe, on
   credit, or posted) stay as they are. Refused while one of them waits for a manager.
3. The reason is written in: *System Audit: Migrated from 17/11/2026 to 16/11/2026 by Boss due to:
   wrong initial entry* is added to the day's notes and to each invoice's note, and to the day's
   **audit trail** (`AuditTrail`, سجل التدقيق), a timestamped line each, shown under the day and never
   changed by anyone (the notes can still be typed over; the trail cannot). The day's notes take up
   to 2,000 characters and an invoice's note up to 1,000 to leave room for these lines.
4. The page opens on the day it was moved to.

- Only onto the day to close next (`targetDate`, the one the manager saw), and never a submitted
  draft (undo it first).
- Days are never merged: a day to close next with entries of its own refuses it (hand them in or
  take them off first); an empty draft left there is taken away to make room.
- The POS's Z reports and takings stay on their own dates: they are what the till recorded, not
  what was typed.
- `POST /api/costing/end-of-day/{id}/reassign-date` with `{ "targetDate", "auditReason" }`, a
  manager's; the answer is the day, the date it came `from` and the `purchaseInvoicesMoved`.

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

## Purchase orders and the 3-way match (أوامر الشراء ومطابقة الاستلام الثلاثية)

A purchase order (`PurchaseOrders`, `PurchaseOrderLines`) is what is ordered from one supplier: its
**PO number** (`PO-year-sequence`, `PO-2026-0001`, by the year it is ordered in), the supplier, the
**order date** and the **expected delivery date** (not before it), the **payment terms** (Cash or
Credit: a delivery is paid so unless its invoice says otherwise; Credit to begin with for a supplier
that gives days to pay), notes for the supplier, and its lines: each material (bought, never a
prep item) once, the **ordered quantity** in the material's purchase unit, the **expected unit cost**
(net, per purchase unit: the latest net price paid, or the cheapest supplier's from the planner, or
the material's average when it was never bought) and line notes. What each line has **received**
(`ReceivedPurchaseQty`) is counted from the posted invoices that name the order, never typed.

**Its life** (الحالة):

| Status | What it means | How it gets there |
| --- | --- | --- |
| Draft (مسودة) | Being written; changed freely | Written by hand, or from the planner by anyone who may not approve |
| Approved / Open (معتمد / مفتوح) | Ready to send, open for deliveries | Approved by a manager: at once for a manager, or a manager approving the request (Approvals, module Purchase order) |
| Partially received (استلام جزئي) | Part has come, the rest is a backorder | A delivery short of the order, kept open |
| Completed (مكتمل) | Nothing more is expected | Every line received in full, or closed with what came (by the invoice that closed it, or by a manager by hand) |
| Cancelled (ملغى) | Called off | A draft by whoever writes orders; an approved one with nothing received by a manager |

A draft waiting for approval is locked until a manager decides; rejected, it stays a draft. Once
anything has come, an order is not cancelled: what is left is closed instead.

**From the order planner**: the approved quantities, a purchase order per supplier, each material
under who sold it last, or the cheapest supplier when the sheet is grouped so, at that price. The
**preview** lists each supplier's order (its delivery day, tomorrow to begin with, and its terms
chosen there) and, apart, the materials no one has sold yet, each given a supplier there or left
out. Sent, all are written or none (each refusal said by its supplier): approved at once for a
manager, drafts each asked of a manager for anyone else.

**Purchases → Purchase orders (أوامر الشراء)** (`/costing/purchases/orders`): every order newest
first, searched by number, supplier or who wrote it, with status pills (All, Draft, Approved / Open,
Partially received, Completed, Cancelled, each with its count), a supplier filter, the received %
and what is left to come (each with its (ⓘ)), and a late mark on an open order past its expected
day. **New purchase order** writes one in the same grid as New invoice (Enter moves along a line and
adds the next). An order's page (`/costing/purchases/orders/{id}`) shows its lines (ordered, received,
left to come, expected price, line total), who wrote and approved it, and:

- **Print PO · طباعة أمر الشراء**: the company's logo and name, the PO number and date, the supplier
  (and phone), the expected delivery, the payment terms and the items with their quantities (what
  is left of a part-delivered order), never what they are expected to cost the kitchen.
- **Copy for WhatsApp · نسخ لإرسال واتساب**: the same as a message in Arabic and English, ready to paste.
- **Receive & match invoice · استلام ومطابقة فاتورة** (open orders): New invoice with the order chosen.
- **Close with what came** (a manager's, partly received) and **Cancel**.
- **Deliveries & invoices history (سجل التوريدات والفواتير)**: every invoice posted against it (and
  any voided since, struck out, or waiting for a manager), each opening the invoice and its paper.

**Receiving against an order**: on **New invoice** (the Purchase order field, or `?po=`), on each
invoice of a **Daily batch**, and from an invoice handed in at the **end of the day** that names
its order (its purchase order field, offered from the supplier's open orders). The order's open
lines come onto the invoice at what is left of each and at the expected price, to be typed over as
the paper and the door say; the supplier is the order's (another supplier's invoice is refused).
The **3-way match** (المطابقة الثلاثية) sets the order (what was ordered, at what price), the goods
received (the quantity on the invoice) and the supplier's invoice (what each line is billed) side by
side, worked out as it is typed and again by the server (`ThreeWayMatch`) as it is posted:

```
Received (purchase units) = the line's quantity in the material's own unit ÷ its purchase unit size
Net unit price            = (line total − line discount − its share of the invoice discount) ÷ received
Left to come              = ordered − what earlier posted invoices brought
Price overcharge          = net unit price > expected unit cost × (1 + 0.5%), and at least a piastre more
                            Overcharge = (net unit price − expected) × received
Qty over                  = received > left to come      (an item not on the order: all of it)
Partial / short           = received < left to come
Matched                   = none of these
```

Each row shows the material and its purchase unit, ordered / left to come, the received quantity,
line total and line discount (typed there or on the invoice's own lines), the expected price, the
net unit price, and its badge: **Matched · مطابق** (green), **Price overcharge · زيادة سعر** (red, with
the jump per unit and the overcharge), **Qty over · كمية زائدة** (red, with the excess), **Partial / short
· استلام جزئي** (amber), **Not ordered · غير مطلوب**. Expense lines (a delivery charge) are not matched.

- **Short**: **Keep remaining balance open (Backorder) · إبقاء المتبقي كأمر شراء مفتوح** (the order
  Partially received, Remaining = ordered − received) or **Close PO with received qty · إغلاق أمر
  الشراء بالكمية المستلمة** (`ClosesPurchaseOrder`: the order Completed once the invoice is posted).
- **Over the order's price or quantity, anyone but a manager** does not post: the invoice is kept as
  a draft, its stock out and the average costs as they were, and a request goes to Approvals
  (module Purchases, New) saying the order, each price jump (expected against billed, each and in
  all) and each excess (left to come against what came), and the invoice's total. Approved, it is
  posted as it was entered: its stock in at its own prices, its payment settled, and it counts on
  the order. Rejected, it stays a draft to be put right. A manager's posts at once, the panel saying
  what is over. A short delivery alone never waits.

**What is received is counted from the invoices**: after any invoice against an order is posted or
voided (or corrected: a correction keeps its order), each line's received quantity is counted again
from the posted ones; voiding the invoice that closed an order opens it again. The invoice names
its order (`PurchaseInvoices.PurchaseOrderId`), shown on the invoice with a link; an invoice handed in
at the end of the day carries its order to the batch (`EndOfDayInvoices.PurchaseOrderId`). Migration
`AddPurchaseOrders`.

The API, on `/api/inventory/purchase-orders` (Purchases; the list for the planner and the end of the
day too): `GET` (`?status=&open=&supplierId=`), `GET open` (in full, for receiving), `GET {id}`,
`PUT {id}` (a draft), `POST {id}/approve` (200 approved, 202 asked), `POST {id}/cancel`,
`POST {id}/close` (a manager's), `POST batch`. An invoice is received against an order with
`purchaseOrderId` and `closesPurchaseOrder` on `PUT purchase-invoices/{id}` (or a daily batch's
invoice); its DTO carries `purchaseOrder` (the match, on a draft) and `awaitingApproval`.

## Suppliers: payment terms, aging and the statement of account

**Payment terms** (مدة السداد): each supplier has the days it gives to pay a credit invoice, 0 to
365 (0 unless set: due on the day), on the supplier's dialog under Purchases → Suppliers.

**AP aging (تقرير أعمار ديون الموردين وتخطيط السيولة)**, Financials → **AP aging**
(`GET api/financials/ap-aging?asOf`, today unless set): what is owed to each supplier on a day, and
by how long it has been past due.

- Payments are set against what was owed before the treasury first, then the credit invoices,
  oldest first, as the open invoices are. Each invoice still owed is due its supplier's payment
  terms after its date; what was owed before the treasury is due from when it was entered.
- Days past due on the day asked put what is left of each in a bucket: **Current** (not due yet,
  0 or less), **1–30**, **31–60**, **61–90** and **90+ days**.
- The strip shows the **total AP liability** and each bucket with its share of it, and a bar of
  the same; the table each supplier owed anything, its terms and open invoices, its buckets and
  its oldest due date. A supplier opens its statement.

**The statement of account (كشف حساب مورد تفصيلي)** (`GET api/suppliers/{id}/statement?from&to`,
and `…/statement/sheet` for Excel; for Financials or Purchases; this year unless set): one
supplier's account from one day to another, opened from Purchases → Suppliers, Financials →
Supplier debts (**Full statement**) and the AP aging.

- **The summary:** the opening balance (what was owed coming in), what was entered in the period
  as owed before the treasury (only when there is any: added like an invoice), the credit
  invoices, the cash invoices, the payments, and the closing balance = opening + owed before +
  credit invoices − payments. A cash invoice is owed and paid at once, so it is in both columns
  and leaves the balance where it was; the ledger's totals add up the same way.
- **The ledger**, in order, with the running balance after each line: the opening balance, each
  invoice (credit or cash: its number, who entered it and who approved it), and each payment (from
  the safe or a day's takings, and its notes). An invoice opens its lines; a payment opens its
  voucher's details.

## Waste and breakage

Spoilage takes materials or prep items from stock at their cost. Breakage (كسر) is something
broken (a plate, a glass): its description, how many and what each cost, and who broke it if
known; its cost counts on the day, and voiding it (on approval) takes it off.

## Staff meals and hospitality (وجبات العاملين والضيافة)

What leaves stock on purpose is not spoilage and not a loss. Waste → **Staff meals & hospitality**
(`/costing/waste/staff-meals`) logs it apart, in three kinds, each a stock movement reason of its
own:

| Kind | Reason | Where its cost goes |
| --- | --- | --- |
| Staff meal (وجبة عاملين) | `StaffMeal` | Labor: the KPIs' wages and benefits (when wages are known) and the plate cost's labor pool |
| Hospitality (ضيافة) | `Hospitality` | A cost of its own: the KPIs' expenses and the overhead pool |
| Recipe tasting (تجربة وصفة) | `RecipeTasting` | The same as hospitality |

- **Recording** (`POST api/inventory/staff-meals`, `{ entryId, kind, note, lines: [{ rawMaterialId
  | recipeId, quantity }] }`, Waste's): a line is a material or prep item (its quantity in its own
  unit: grams, millilitres, pieces) or a dish (in whole plates). A dish takes what a sale takes:
  its recipe's ingredients, prep items from their own stock. Each is taken at the average cost
  now; the entry is recorded once however often it is sent.
- **The report** (`GET api/costing/staff-meals?from&to`, for Waste or Reports): each day's staff
  meals, hospitality and tastings, and each entry with what it took and what it cost.
- **The daily budget** (Cost settings → Staff meals, `dailyStaffMealBudget`, blank for none): a day
  whose staff meals cost more is marked **over budget** in amber, by how much.
- **Kept out of the unexplained:** the consumption report takes it out of the actual usage, and
  variance out of what was expected, each with its own column and figure; the stock card lists
  each entry as waste of its kind and opens it.
- **Voiding** an entry works as a spoilage's: on approval, it puts back what it took.

## Financials: takings, tax and the safe

**The safe is the one treasury.** Everything collected goes into it: the cash, the Visa and the tax
collected on them, as well as the opening balance and any funding. Everything paid goes out of it:
invoices paid in cash, supplier payments, expense vouchers, tax paid over, advances and salaries,
and fixed assets bought out of it (CAPEX, below). The bank (`CashFund.Bank`) holds only what a fixed
asset is bought or sold through when it is not cash: the safe's balance and reports never count it.

**A day's takings (توريد إيراد اليومية)** are entered once a day from its Z report, on Financials →
Safe → Takings in (or a day on Funding with sales and no takings yet), in this order:

| Field | Stored as | What it does |
| --- | --- | --- |
| Date (تاريخ اليومية) | `RevenueDate` | The business day the takings are of |
| Cash (إيراد الكاش) | `GrossAmount` | Cash sales before tax: revenue, into the safe |
| Visa / Card (إيراد الفيزا) | `CardAmount` | Visa sales before tax: revenue, into the safe |
| Total tax collected (إجمالي الضريبة المحصلة) | `TaxAmount` | Collected on top: into the safe, owed to the tax authority, never revenue |
| Voids & refunds (قيمة الفويد والمرتجعات) | `VoidsAmount` | Said, not taken off again (cash and Visa are after them) |
| Discounts & promos (الخصومات والعروض) | `DiscountsAmount`, `DiscountReasons` | Taken off the menu prices before the money was collected: said, never in the safe; read by the KPIs' margin erosion. The reasons come with the end of day handed in, or from the POS |
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

## Fixed assets and depreciation (سجل الأصول الثابتة والإهلاكات)

**CAPEX is not OPEX.** An operating expense (OPEX: rent, gas, a repair, wages) is used up in the
month it is paid and goes on that month's P&L whole, as an expense voucher or an invoice's expense
line. A fixed asset (CAPEX: an espresso machine, an oven, the dining room's furniture, the POS, a
vehicle, the fit-out) serves for years: what it cost leaves the safe or the bank the day it is
bought, but **the P&L never takes the purchase**, only its depreciation, a month at a time over its
useful life. Buying a 120,000 machine in March does not make March a 120,000 loss.

**Financials → Fixed assets (الأصول الثابتة)** (`/costing/financials/fixed-assets`, also at
`/costing/fixed-assets`) is the register (`FixedAssets`). **Asset acquisition (CAPEX) · شراء أصل
ثابت** is on it, and beside **New expense voucher** on Financials → Expense vouchers:

| Field | Stored as | What it is |
| --- | --- | --- |
| Asset code (كود الأصل) | `Number`, `AssetCode` | FA-0001, FA-0002, … in the order they are entered, never reused |
| Name (اسم الأصل) | `Name`, up to 120 characters | "La Marzocco espresso machine" |
| Category (الفئة) | `Category` | Kitchen equipment, Furniture, Vehicles, IT & POS, Fit-out & decoration, Other |
| Location (الموقع) | `Location`, up to 80 characters | Free text with the ones used before suggested: Costing keeps no storage locations of its own |
| Purchase date (تاريخ الشراء) | `PurchaseDate` | Today or before; for a paid asset, the day the cash left |
| Purchase cost (تكلفة الشراء) | `PurchaseCost` | All it cost to buy and put in place, more than nothing |
| Salvage value (القيمة التخريدية) | `SalvageValue` | What it is still worth at the end of its life: 0 or more, less than the cost; never depreciated |
| Useful life (العمر الإنتاجي) | `UsefulLifeMonths` | 1 to 600 months: 60 for five years |
| Paid from (مصدر الدفع) | `PaidFrom`, `PurchaseTransactionId` | The safe, the bank, or owned already (below) |
| Notes | `Notes`, up to 500 characters | The supplier, the invoice number, the serial number |

**Paid from the safe or the bank**, the purchase is a safe entry, `AssetPurchase` (شراء أصل ثابت),
of the whole cost, dated the purchase date: out of the safe (its balance, the Safe tab's **Total out**,
noted "of it fixed assets (CAPEX), not expenses", and Reports → Safe & treasury's outflow **Fixed
assets bought (CAPEX)**), or out of the bank, which the safe never counts. As every safe entry, it is
a manager's at once and a request for anyone else, and the asset is not on the register, nor the
cash moved, until a manager approves it (the request says the asset, its category, life, salvage
value, monthly depreciation and where it is paid from). **It is never an expense voucher**: the
expense vouchers' total, the spending report and the P&L's operating expenses leave it out. **Owned
already (أصل قائم)**: an asset the restaurant had before the register, entered at what it cost and
when, for its depreciation from then; no cash moves, and it is a manager's.

**Depreciation is straight-line** (القسط الثابت), worked out from the register whenever it is read:

```
Monthly depreciation     = (purchase cost − salvage value) ÷ useful life in months, to the piastre
Months charged by month M = months from the purchase month to M, the purchase month counted,
                           never the month it is disposed of or after, at most the useful life
Accumulated depreciation = monthly depreciation × months charged
                           (the whole of cost − salvage once the life is through)
Net book value (القيمة الدفترية) = purchase cost − accumulated depreciation
Month M's depreciation   = accumulated by the end of M − accumulated by the end of the month before
```

A month is charged in full: the month an asset is bought is its first, whatever day, and the month
it is disposed of or sold is not charged. The last month of its life takes what the rounding left,
so the depreciation adds up to the cost less the salvage value exactly (1,000 over three months:
333.33, 333.33, 333.34). Example: bought on 15 March 2026 for 120,000 with 12,000 left after 60
months, it is charged 1,800 a month from March 2026 to February 2031; by December 2026, ten months,
18,000, leaving 102,000. A change to the useful life or the salvage value restates every month's
depreciation, past ones too: a correction. A paid asset's cost and date are its payment's: void the
purchase and enter it again; an owned-already asset's may be changed.

**Its status (الحالة)**, as of the month shown: **Active** (نشط, green) while it is depreciated;
**Fully depreciated** (مهلك بالكامل, grey) once its life is charged, still in use; **Disposed**
(مستبعد) or **Sold** (مباع), from the month it went.

**Dispose / sell asset · استبعاد أو بيع الأصل** stops its depreciation:

- **Sold** (بيع): what it brought in goes into the safe or the bank, an `AssetSale` safe entry on the
  sale date (a manager's at once, a request for anyone else). Into the safe, it is in the Safe tab's
  **Total in** ("from fixed assets sold") and the analysis's inflow **Fixed assets sold**: never revenue.
- **Written off** (استبعاد بلا مقابل): scrapped or given away, nothing for it; a manager's.

```
Net book value at disposal = purchase cost − depreciation charged before the disposal month
Capital gain / (loss)      = sale proceeds (0 for a write-off) − net book value at disposal
```

The gain or loss is the disposal month's, on its P&L. The dialog shows the book value, what it
brought in and the gain or loss as they are typed. **Void the sale** voids its safe entry (what it
brought in goes back out) and the asset is in use again, depreciated from where it stopped; **Undo
the write-off** does the same for a write-off. **Void the purchase** voids a paid asset's purchase
entry (what it cost goes back) and takes it off the register; a sold asset's purchase is voided only
once its sale is. An owned-already asset is **removed** from the register (a manager's). Kept, never
deleted: off the register, it is only marked so (`VoidedAtUtc`).

**The register screen**, at the end of a month (the arrows move it; today's month by default):

1. **Total assets cost** (إجمالي تكلفة الأصول): Σ cost of what was held then, bought by its end and
   not disposed of or sold by then.
2. **Accumulated depreciation** (مجمع الإهلاك): Σ their depreciation up to and including the month.
3. **Net book value** (القيمة الدفترية الحالية): total assets cost − accumulated depreciation.
4. **Monthly depreciation run rate** (قسط الإهلاك الشهري الحالي): Σ the month's depreciation of every
   asset: exactly the P&L's depreciation line from the register.

Each with its (ⓘ). Below them, the month's **CAPEX**: bought out of the safe, by the bank, owned
already added, what the sales brought in and their gain or loss. The grid: asset code, name (with
its location and how it was paid), category, purchase date, cost, useful life (and the months
charged), monthly depreciation, accumulated depreciation, net book value and status (a badge), with
the disposal and its gain or loss under the name; every column sorts (its heading, or the sort pill),
with a search and category and status filters, and the shown assets still held totalled. Below,
what each category holds. **Export register to Excel** gives the register at the month's end, every
asset with its figures and a total, and a sheet by category.

**On the P&L** (Reports → KPIs' statement, and `GET /api/costing/reports/pnl?year=&month=`):

```
Revenue (net sales)
− Cost of sales (recipes' cost of what was sold, waste, spoilage, count differences)
= Gross profit (مجمل الربح)
− Operating expenses (المصروفات التشغيلية): wages and benefits, running costs, rent and
  occupation, other fixed costs, hospitality and recipe tastings
= EBITDA (الربح التشغيلي قبل الفوائد والضرائب والإهلاك)
− Interest (الفوائد), as entered for the month
− Depreciation expense (إهلاك الأصول الثابتة) = the register's for the month + any entered for the month
± Gain / (loss) on asset disposals (أرباح / (خسائر) استبعاد الأصول) in the month
= Net profit (صافي الربح النهائي)
```

**The month's depreciation from the register** is Σ, over every asset on it, of its depreciation
for the month: each bought on or before the month's end, its life not yet through, and not disposed
of or sold before the month (an asset sold later was active then: a closed month's P&L stays as it
was). EBITDA and the net profit wait for the month's wages, as the net profit always has. The KPIs'
net profit margin is after depreciation and disposals; the break-even's depreciation and the plate
cost's overhead pool include the register's. The depreciation still entered by hand on the KPIs is
for assets not on the register: an asset on it and entered too would be counted twice.

`GET /api/costing/reports/pnl` returns the same, as figures (`Revenue`, `GrossProfit`,
`OperatingExpenses`, `Ebitda`, `Interest`, `AssetDepreciation`, `EnteredDepreciation`, `Depreciation`,
`DisposalGainOrLoss`, `NetProfit`, and the gross, EBITDA and net margins) and as its lines in order.

**Who does what.** Whoever works Financials sees the register and exports it, and records a purchase
or a sale (a request unless a manager); a manager alone enters an asset owned already, changes an
asset's details, writes one off or undoes it, and removes one owned already. The API, on
`/api/financials/fixed-assets`: `GET` (`?year=&month=`), `GET export`, `POST` (a purchase: `PaidFrom`
Safe, Bank or OwnedAlready; 200 made, 202 asked), `PUT {id}`, `POST {id}/dispose` (`SaleProceeds` and
`Fund` for a sale, none for a write-off), `POST {id}/reinstate`, `DELETE {id}`. A purchase or a sale
is voided as any safe entry, a deletion request (module Treasury) on its entry. Migration
`AddFixedAssets` added the table and `SafeTransactions.FixedAssetId`.

## Promos and discounts against the margin (أثر الخصومات وتآكل الهامش)

A discount makes the kitchen's cost a larger share of what came in: the dishes cost the same, the
money collected is less. Reports → **KPIs** sets the month's food cost at the menu prices against
what was actually collected (`KpiReport.Discounts`), from the month's takings (a voided day taken
back out with its reversal):

```
Standard gross revenue (الإيراد القياسي) = net sales + discounts
Actual net revenue (الإيراد الفعلي)      = net sales (cash + card collected, before tax)
Standard food cost %                    = theoretical cost ÷ standard gross revenue × 100
Actual food cost %                      = theoretical cost ÷ actual net revenue × 100
Margin erosion (تآكل الهامش)            = actual food cost % − standard food cost %, in points
```

The theoretical cost is the recipes' cost of what was sold in the month (food and drinks, combos
by their dishes). **Promos & discount impact** (أثر الخصومات والعروض), under the KPI cards:

1. **Total discounts**, and their share of the standard gross revenue.
2. **Standard vs actual food cost %**, with the erosion in points: amber under 5, red from 5.
3. **Top discount reasons**, each with what it took off and on how many bills, the largest first.

Each figure has its (ⓘ). With no takings in the month the percentages are not shown.

## The POS link (ربط نقطة البيع)

A point of sale can send each shift's Z report here, and read the menu from here, over HTTP; it
never touches this database. **Settings → POS Integration** (a manager's, `SettingsManage`) holds
the link:

- **The key.** One a branch: with several branches, each branch's till has its own, made and shown
  for the branch chosen at the top of the screen (*Tanta's till: each branch's POS has its own
  key*), and what a till sends is its own branch's day. *Generate key* makes one (`cpk_` and 32
  random bytes) and shows it once, to be pasted into the POS. Only its SHA-256 hash is kept, with its last four characters to tell it by
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
| `GET /api/integrations/pos/menu` | The menu: categories, items by their number (6101) with price and availability, sizes by their code (6101-17), add-ons (A3), and whether each has a recipe (`hasRecipe`) |
| `GET /api/integrations/pos/suppliers` | The suppliers not archived, for an expense paid from the drawer: `[{ id, name, nameAr }]` |
| `POST /api/integrations/pos/z-report` | A shift's Z report (below) |
| `POST /api/integrations/pos/events` | The POS's own event envelope (`{ id, kind, branchCode, occurredAtUtc, data }`): `day.closed` is read as a Z report, `paid-out` as a paid-out (below); any other kind is answered 202 and left |

A Z report:

```json
{
  "zReportId": "a09d376d-…", "date": "2026-11-10", "shiftNumber": 1,
  "takings": { "totalCash": 220.0, "totalCard": 30.0, "totalTax": 35.0, "voidsAmount": 330.0,
               "voidReasons": [{ "reason": "Item quality", "count": 1, "amount": 140.0 }],
               "discountsAmount": 60.0, "discountReasons": ["Staff", { "reason": "Loyalty", "amount": 50.0, "count": 2 }] },
  "soldItems": [{ "itemCode": "6101-17", "quantitySold": 1 }, { "itemCode": 9003, "quantitySold": 2 }],
  "wastedItems": [{ "itemCode": "6101-18", "quantity": 1, "reason": "Item quality" }]
}
```

As a `day.closed` event the same report comes in the POS's own words: `soldItems` one line per
item, size and channel (`{ itemCode, size, quantity, channel }`), which are added together here
into one line an item; `waste`; and `takings` with `cash`, `card`, `tax`, `discountsAmount` and
`discountReasons` (`[{ reason, count, amount }]`), and the voids before and after the kitchen.

`zReportId` is the POS's id for the shift, the same each time it is sent. Cash and card are
before tax, with the tax collected on them apart, as the day's takings are kept. An item is found
by its code, or a size by its code (`6101-17`); an item sold by size without one names its size
in `size`, and a line with no code is found by its `name`. `wastedItems` were made and then voided
after the kitchen. `discountsAmount` (optional) is what was taken off the menu prices before the
money was collected; each of `discountReasons` is a name (counted once, its amount not said) or `{
reason, amount, count }`. A combo is sold by its code, as any item.

### What a Z report makes

- **The day's sales summary** (`DailySummary`), every line placed on the menu first: one that
  cannot be (a code not on the menu, an item sold by size without its size) refuses the whole
  report, 422, naming every such line, and nothing is recorded. Each item sold takes its stock by
  its recipe (`Sale`); each wasted one is a line voided after the kitchen, its stock taken as waste
  (`Waste`), not charged. An item with no recipe is recorded and the answer warns of it.
- **The day's takings in the safe** (توريد إيراد يومية): the cash and card before tax, the tax,
  the voids and their reasons in the notes, and the discounts with their reasons (every shift's
  together, each reason once), for that business day.
- **The discounts on the sales summary too**: its lines are at the menu's prices, and the day's
  discounts come off them (`DiscountAmount`, with the reasons), never more than they come to (the
  answer warns if they were; the takings keep all of them). The POS day keeps them as well.
- **All of it or none**: both are written in one save.
- **Sent again as it was**: nothing changes (`Unchanged`). **Sent changed** (the shift corrected
  on the POS): what it made is voided, the stock put back and the takings reversed, and the day
  made again (`Updated`).
- **A day's shifts together**: each day has one sales summary and one takings, made from all of
  that day's reports; a second shift's report remakes the day with both.
- **A day entered by hand is left alone**: if its sales summary or its takings were entered here
  by hand (or by sheet), the report is refused, 422, naming which. Void them here to let the POS's
  report in.
- **A day in the books closed** (Settings → Period lock) is not written: the report is refused,
  **423 Locked**, with the lock's day, and the sync log shows it refused. Sent again unchanged, it
  is answered *unchanged* as before.
- A report that collides with another change at the same moment is tried again; if it still
  cannot be saved, the answer is 503 so the POS sends it again later.

The answer says what was done: `{ zReportId, date, outcome, saleId, takingsId, items, quantity,
wasted, salesValue, cash, card, tax, warnings }`.

### A paid-out from the drawer (`paid-out`)

The POS sends each expense and each staff advance its shift paid from the drawer, at the shift's
close, ahead of its `day.closed`:

```json
{
  "paidOutId": "…", "shiftId": "…", "shiftNumber": 3, "businessDate": "2026-11-10",
  "kind": "Expense", "amount": 80.0, "note": "Ice", "givenBy": "Mona",
  "employeeId": null, "employeeName": null, "supplierId": "…", "supplierName": "Nile Farms",
  "receipt": { "contentType": "image/jpeg", "fileName": "r.jpg", "base64": "…" }
}
```

- It goes on that business day's **end of day** (a draft is made for it if the day has none
  yet, ahead of the closing sequence), on the till's branch, under the POS's own id
  (`paidOutId`): sent again, it is answered `Unchanged`.
- **A staff advance** (`StaffAdvance`) is a payout to the employee (`EmployeeAdvance`): the staff
  member synced from HR's `employeeId`, else the one active staff member of `employeeName`;
  anyone else is refused, 422. With the HR link on, it goes on to HR as any advance does.
- **An expense** (`Expense`) is a cash invoice from its supplier: `supplierId`, else the supplier
  of `supplierName`, else **POS petty cash · نثريات نقطة البيع** (made the first time it is
  needed).
- **The photo** an end of day needs is the receipt the POS took (an image or a PDF); with none, a
  one-page PDF slip of what the POS recorded (the shift, who gave it, for what, how much).
- A day already handed in (submitted), one at or before the last closed day, or one in a closed
  period is refused, 422 (or 423), and the POS shows it failed until it is sent again.

The answer: `{ paidOutId, date, outcome, entry, entryId }`, `entry` being `advance` or
`invoice`.
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

  A month in the books closed (its last day on or before the lock) is refused, 423 Locked, and
  logged as refused. Kept as a `PayrollRun` by HR's id for it, one a month: its **labor cost** (gross + additions −
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

## Company structure (هيكلة الشركة الديناميكية والمطبخ المركزي)

How the business is built decides what the system shows and keeps apart, so a single open-space
shop sees nothing of branches or locations. **Settings → Company structure** (a manager's,
`settings.manage`; `/costing/settings/company-structure` leads there too) shows the four
structures as cards, each with its bilingual **(!)** tip; a card chosen is applied with **Switch ·
تطبيق**, and each change is a line of the security audit log
(`OperatingModeChanged: SingleBranch_OpenSpace → MultiBranch_Independent by Wagdy`).

| Structure (`SystemOperatingMode`) | What it is | What the system does |
| --- | --- | --- |
| `SingleBranch_OpenSpace` · فرع واحد بمساحة مفتوحة (**the default**) | All physical goods are in one place. No internal transfers needed. · كل البضاعة في مكان واحد ولا حاجة لأذونات صرف داخلية. | One branch and one implicit Main Store. No location lists, transfer screens or branch selector: one stock figure and one moving-average cost per material, exactly as before. |
| `SingleBranch_WithSubStores` · فرع واحد يحتوي على مخزن ومناطق تشغيل | A single branch containing a locked main warehouse and kitchen operating locations. · فرع واحد يحتوي على مخزن رئيسي مغلق وعُهد تشغيل لأقسام المطبخ. | One branch; inventory locations (Main Store, Kitchen, Bar…) are added on the page, each with its own stock, moved between them by **internal transfer**. |
| `MultiBranch_Independent` · فروع متعددة تشتري وتعمل بشكل مستقل | Multiple branches, each managing its own purchases and stock independently. · فروع متعددة، كل فرع يشتري الخامات ويحسب تكلفته بشكل مستقل. | Branches are added on the page; a branch selector at the top of the screen; records kept and listed by branch; stock and moving-average cost kept per branch. |
| `MultiBranch_CentralKitchen` · فروع متعددة يدعمها مطبخ مركزي | A Central Kitchen/Warehouse purchases and preps items, then supplies/sells them to the restaurant branches. · مطبخ مركزي يشتري ويُصنع الخامات ثم يوردها ويبيعها لباقي الفروع. | Everything several branches have, with a branch of type Central kitchen or Central warehouse, and the **central kitchen hub**: requisitions, Dispatch & Bill, branch receipts. |

**Built so far:** the structures, branches and locations, the branch of each record (phase 1); stock
kept by location and moving-average cost by branch, with internal transfers (phase 2); the central
kitchen's hub, with branch requisitions, **Dispatch & Bill** on an internal sales invoice and the
branch's **Receive** on an internal purchase invoice (phase 3, below); the P&L by branch or for the
company as a whole, consolidated, inter-branch sales and purchases eliminated (phase 4, below); and
each branch's own end of day, takings and till (below). The safe's balance and the other reports
are the company's, whatever the structure.

### Branches and locations (الفروع ومواقع المخزون)

- **The first branch** (`Branch.DefaultId`), made by the migration and named after the company
  (*Main branch* on a new install), and its **Main Store** (`InventoryLocation.DefaultId`). Every
  record made before is theirs. The first branch is always in use, and its main store stays its
  main store; either may be renamed, in any structure.
- **Branches** (`Branches`: name, Arabic name, type Restaurant, Central kitchen or Central
  warehouse, in use) are added once the structure has several; each new branch gets its own
  **Main Store**. Names are unique. A branch is taken out of use, never deleted: its records stay.
- **Locations** (`InventoryLocations`: branch, name, Arabic name, kind Main store, Kitchen, Bar or
  Other, in use, and the **stations it serves**) are added once the structure has them (not in an
  open-space shop), unique by name within their branch. A kitchen or bar station is served by one
  location of a branch (*a station takes its stock from one location*): what its dishes use when
  sold comes off that location's shelves.
- **Back to one branch** (either single-branch structure) only while the first branch is the one in
  use: *Take Tanta out of use first: a single-branch company works in its first branch alone.*

### The branch of each record (BranchId)

Purchase invoices, safe entries, the POS's Z reports, sales, stock movements (waste among them),
breakage and stock counts each keep a `BranchId` (`IBranchOwned`), the first branch's by default
(the column's default, which is what every record before has). Each new record gets the branch of
the request as it is saved (`BranchStampInterceptor`), except what comes from another record,
which keeps that record's branch: a stock entry its invoice's, count's or sale's, a payment its
invoice's, a reversal or void the original's, an invoice correction the corrected invoice's. So a
manager who works every branch, voiding a Tanta invoice while working in Alexandria, voids it in
Tanta.

**The branch of a request** (`ICurrentBranch`): in a single-branch structure, always the first
branch, whatever is asked, and no list narrowed. With several branches: the branch the user is
kept to; or, for one who works every branch, the one they chose at the top of the screen (sent as
`X-Branch-Id`; one not in use, or none, is the first branch). A user kept to a branch that is out
of use is refused (403). A branch's till, signed in by its own POS key, works in that branch; HR,
signed in by key, in the first branch.

With several branches, these lists show the branch's own records: purchase invoices, sales, stock
counts, spoilage and breakage. Balances and reports stay the company's; the KPIs and P&L are read
for a branch or for the company as a whole (below).

### Users and the branch selector

A manager keeps a user to a branch (**Branch · الفرع** on Users, with several branches: a branch, or
*Every branch*). The token says it (claim `branch`), and every request checks it against the user's
record, so a change signs them out wherever they are signed in. Someone kept to a branch sees it at
the top of the screen; someone who works every branch chooses it there (a menu beside their name),
kept in the browser, and every screen is read again for it.

**Kept** in `costing.Branches`, `costing.InventoryLocations`, `costing.CompanySettings.OperatingMode`
(`SingleBranch_OpenSpace` by default), `BranchId` on `PurchaseInvoices`, `SafeTransactions`,
`PosZReports`, `SalesReceipts`, `StockMovements`, `BreakageEntries` and `StockCounts`, and
`identity.Users.BranchId` (migration `AddCompanyStructure`). `GET /api/settings/company-structure`
gives `mode`, `branches` (with their locations counted) and `locations`; `PUT
/api/settings/company-structure/mode` takes `{ mode }`; `PUT /api/settings/branches/{id}` takes `{
name, nameAr, type, isActive }`; `PUT /api/settings/locations/{id}` takes `{ branchId, name,
nameAr, kind, isActive }` (all `settings.manage`). `GET /api/branches` gives the mode and the
branches in use, to anyone signed in; `GET /api/settings` carries `operatingMode`; `POST /api/users`
and `PUT /api/users/{id}` take `branchId`.

### Stock by location and cost by branch (المخزون حسب الموقع والتكلفة حسب الفرع)

**An open-space shop works exactly as before.** Every entry is its one Main Store's, there is no
location to choose anywhere, the Internal transfers screen is not listed, and each material keeps
one stock figure and one moving-average cost. Nothing below shows until the structure has
locations.

- **Stock is kept by location.** Each stock movement keeps the location it was put in or taken
  from (`StockMovements.LocationId`; every movement before is the first branch's Main Store). A
  location's stock of a material is the sum of its movements, never a figure kept apart, so it
  cannot drift from the ledger; a unit restated rescales the movements, and with them every
  location. The material's own stock (`RawMaterials.QuantityOnHand`) stays the company's total.
- **Cost is kept by branch** (`MaterialBranchStocks`: material, branch, average cost; one row a
  material and branch, the first branch's seeded with every material's average by the migration).
  With one branch it is the company's average, kept the same. With several, a delivery or a batch
  made moves its own branch's average, by the same arithmetic as before on the branch's stock; one
  voided takes its price back out; and the company's average becomes the branches' stock at their
  own averages. What a branch uses, throws away, counts or moves is valued at its own average
  (Tanta's lettuce at Tanta's 0.05 a gram while the first branch's is 0.03). All the locations of a
  branch share its one average.

**Where each entry goes** (موقع الحركة), once there are locations:

| Entry | Its location |
| --- | --- |
| A purchase invoice, the daily batch | **Receiving location · موقع الاستلام**, chosen on the invoice or the batch (the main store until another is); a correction keeps the original's |
| A production batch | **Made in · موقع التصنيع**: its ingredients taken from there and the batch put there |
| Spoilage, staff meals and hospitality | **Thrown away from · موقع الهالك**, **Taken from · موقع الصرف** |
| A stock count | **Count where · مكان الجرد**: one location, its book figures that location's; or **Whole branch · كل الفرع**, the branch's total, its difference taken at the main store |
| A sale (POS or entered), a void's waste | The location serving the material's station in the branch (or the waste's station held to account); else the branch's main store |
| Anything else (opening stock, transfers' own) | What it says; else the branch's main store |

A location named must be one of the branch's, in use (*Hot Kitchen is not in use*, *Tanta store is
another branch's*); in an open-space shop whatever is named is ignored: its one Main Store.

### Internal transfers (التحويلات الداخلية)

**Operations & inventory → Internal transfers** (`/costing/internal-transfers`), listed after the
counts once the structure has locations, for whoever works **Stock counts** or **Raw materials**;
made and voided by whoever keeps the stock (`inventory.manage`), their costs only for whoever
sees costs (a storekeeper moves the stock without its value).

- **New transfer · تحويل جديد:** from and to (two locations of the branch; swapped with one click),
  the materials with their quantities entered as they are counted (kg, L, pieces), what the
  location it leaves has beside each, and notes. **Move stock · تحويل** posts it today, numbered by
  its year, `TR-2026-0001`; its id is made by the screen, so sent again after a lost answer it is
  made once.
- **Refused:** the same location twice (*the two are the same*), two branches' (*inside one
  branch*), a location not in use, no line, a material twice, or more than the location it leaves
  has (*Main Store has 3000 Gram of Flour: not enough to move 3500*). An open-space shop has none
  (*An open-space shop keeps its stock in one place*).
- **Posted:** each line a **TransferOut** from the one location and a **TransferIn** to the other,
  at the branch's average cost (`UnitCostSnapshot`, `LineTotalCost`): the company's stock and cost
  as they were, nothing on the P&L. The material's stock card leaves transfers out (they move
  nothing in or out of the company); the locations show them.
- **Voided · إلغاء** (confirmed first): both sides of each line go back, on the books of the day it
  was made (the period lock applies to both).
- **The list:** a period (the last 30 days until others are chosen), searched by number, material,
  notes or who made it, filtered by where it left, where it went and its status; each **printed as
  a slip** (إذن تحويل: number, day, from, to, the materials, their costs for whoever sees them, and
  *Handed over by · المسلِّم* / *Received by · المستلِم* to sign), and the period sent as a workbook
  (**Excel**: *Transfers* and their *Lines*).
- **Stock by location · الرصيد حسب الموقع:** a row a material, a column a location, the branch's
  total and its value at the branch's average; searched by material or code.

**Kept** in `StockMovements.LocationId`, `PurchaseInvoices.LocationId`, `StockCounts.LocationId`,
`ProductionOrders.LocationId`, `InventoryLocations.StationIds`, `MaterialBranchStocks`,
`InternalTransfers` and `InternalTransferLines` (migration `AddStockLocations`). `GET
/api/inventory/stock-locations` gives the mode, the branch and its locations in use (any costing
tab); `GET /api/inventory/location-stock` what each has; `GET /api/inventory/internal-transfers?from=&to=`
(at most 366 days), `GET …/internal-transfers/{id}`, `GET …/internal-transfers/sheet?from=&to=`
(`inventory.view`, Stock counts or Raw materials); `POST …/internal-transfers` takes `{ id,
fromLocationId, toLocationId, lines: [{ rawMaterialId, quantity }], notes }` and `POST
…/internal-transfers/{id}/void` (`inventory.manage`). The invoice, batch, production, spoilage,
staff meal and count requests take `locationId`; `PUT /api/settings/locations/{id}` takes
`stationIds`.

### The central kitchen hub (مركز عمليات المطبخ المركزي وتحويلات الفروع)

Only in a company run as **Branches with a central kitchen** (`MultiBranch_CentralKitchen`):
**Operations & inventory → Inter-branch hub · المطبخ المركزي وتحويلات الفروع**
(`/costing/inter-branch`), listed after the internal transfers for whoever works **Stock counts**,
**Raw materials** or **Purchases**. Opened in any other structure, it says so (*The company is not run
with a central kitchen*) and holds nothing; every request is refused there too. Each branch is a
**Restaurant**, a **Central kitchen** or a **Central warehouse** (Settings → Company structure); the
last two supply the others.

The hub works in the branch chosen at the top of the screen (or the user's own): a restaurant asks
and receives, the kitchen dispatches. Its cards, each with its **(!)** tip, count for that branch:
**Open requisitions** (asked by it or of it, submitted or partly dispatched), **Shipments in
transit** (sent by it or to it, not yet received), **Receipts this month**, and **Inter-branch
billing** this month (whoever sees costs). Three tabs: requisitions, the kitchen's dispatches, the
branches' receipts; a period (the last 30 days, with whatever is still open or on its way whenever
it was made), searched and filtered by status; **Excel** sends the period as a workbook
(*Requisitions*, *Dispatches* and *Receipts*, each with its lines).

**1. The requisition (أمر طلب بضاعة من الفرع), `REQ-2026-0001`.** The branch asks a central kitchen or
warehouse (never a restaurant, never itself) for materials or prep items, in the unit they are
counted in, with a date wanted and notes. Nothing moves, so no books. Printed as a slip and
**copied for WhatsApp**: quantities and units only, never a price. **Cancelled** (by either branch)
only while nothing of it has been dispatched. Its status follows its shipments: *Submitted ·
مرسل للمركزي*, *Partly dispatched · صرف جزئي* (a line still short), *Dispatched · تم الصرف وفي
الطريق*, *Received · تم الاستلام بالفرع*, *Cancelled · ملغي*; each line keeps what was asked,
dispatched and received.

**2. Dispatch & Bill (إذن صرف وفاتورة بيع داخلية), `ISI-2026-0001`.** The kitchen opens a requisition's
**Dispatch & Bill** (the lines still asked, filled in) or a **Direct dispatch** to a branch, chooses
the location it leaves (its main store by default), and how it is priced
(**سياسة تسعير التحويل الداخلي**):

- **At cost · بالتكلفة:** each line billed at the kitchen's own weighted average cost
  (`MaterialBranchStocks`).
- **Transfer price · سعر تحويل:** its cost plus a markup % (0–1000), or a price typed for the line
  (whoever sees costs; a storekeeper's dispatch is priced by the markup alone).

Only what the location holds is sent: more is shown in red and refused (*Central Store has 10000
Gram of Tomato sauce: not enough to send 12000*); a material with no cost yet in the kitchen is
refused. Posted at once: each line an **InterBranchDispatchOut** out of that location at the
kitchen's average, and the internal sales invoice (`IsInterCompany`): **billed** (inter-company
revenue, quantity × transfer price), **cost of goods** (inter-company COGS, quantity × the kitchen's
average) and the **margin**. It is then *In transit* and on the receiving branch's **Incoming
shipments**. Printed as the internal invoice with prices, or as a delivery note without them for
whoever does not see costs.

**3. The branch's receipt (استلام الفرع وفاتورة مشتريات داخلية), `IPI-2026-0001`.** The branch clicks
**Receive shipment · تأكيد استلام الشحنة**, chooses the location it goes into (its main store by
default), and counts each line (all of what was sent unless said; never more). Posted at once: each
line an **InterBranchReceiptIn** into that location **at the transfer price**, which moves the
branch's own average cost as a delivery's price does (5 kg at L.E 80 on the shelf, 5 kg received at
L.E 110: L.E 95), so its recipes and food cost carry what it paid the kitchen; prep items are
received this way too. The internal purchase invoice (`IsInterCompany`) is billed for everything
sent, so it matches the kitchen's; **what did not arrive** never enters stock and is kept as the
receipt's **transit loss** (short × transfer price), and the receipt needs a note saying what
happened. The shipment and the requisition are marked received.

**Voids (إلغاء الصرف أو الاستلام).** A dispatch still on its way is voided by the kitchen: its goods go
back to the location they left, the internal sales invoice is voided, and the requisition returns
to *Submitted* (or partly dispatched). A received shipment is voided by a **manager** only, from its
receipt: both invoices are voided, the branch's goods taken back out (its average without them) and
the kitchen's put back, and the requisition restated. Both are held to the period lock, on the days
they were made.

**What the company's figures show.** The material's own stock is the company's: it drops when the
kitchen dispatches and rises when the branch receives, so a shipment in transit is in neither, and a
transit loss leaves the company's stock. The company's average is its branches' stock at what it
cost the company (each branch's average, but for the markup one branch paid another: below); the
stock card lists both movements (*Between branches · بين الفروع*, with the invoice number, each
opening the hub). The reports that judge usage and waste leave inter-branch movements out. The
company's P&L takes inter-company revenue, the cost of goods and the markup out (below).

**Kept** in `InterBranchRequisitions` (+ lines; the asking branch as `RequestingBranchId`),
`InternalSalesInvoices` (+ lines; `SupplyingBranchId`, `ReceivingBranchId`, `FromLocationId`,
`Pricing`, `MarkupPercent`, `Status`, `TotalTransferRevenue`, `TotalInternalCogs`,
`InternalMargin`, `IsInterCompany`) and `InternalPurchaseInvoices` (+ lines; `ReceivingBranchId`,
`InternalSalesInvoiceId`, one receipt a shipment, `TotalBilled`, `TotalReceivedValue`,
`TotalTransitLoss`), migration `AddInterBranchHub`; movement reasons `InterBranchDispatchOut = 15`
and `InterBranchReceiptIn = 16`. `GET /api/inter-branch?from=&to=` gives the hub (mode, branch,
branches, cards, requisitions, shipments, receipts) and `GET /api/inter-branch/sheet` the workbook
(`inventory.view`; Stock counts, Raw materials or Purchases); `POST /api/inter-branch/requisitions`
takes `{ id, supplyingBranchId, requestedDeliveryDate, lines: [{ rawMaterialId, quantity, notes }],
notes }`, `POST …/requisitions/{id}/cancel`; `POST …/shipments` takes `{ id, requisitionId |
receivingBranchId, fromLocationId, pricing, markupPercent, lines: [{ rawMaterialId, quantity,
transferUnitPrice }], notes }`, `POST …/shipments/{id}/void`; `POST …/receipts` takes `{ id,
shipmentId, toLocationId, lines: [{ rawMaterialId, receivedQuantity }], notes }`
(`inventory.manage`); `POST …/receipts/{id}/void` (`approval.decide`, a manager). Quantities in the
material's own unit, prices per that unit; prices and totals are null for whoever does not see
costs.

### Each branch's day (تقفيل اليوم لكل فرع)

With several branches, **each closes its own days**, as one restaurant always did: one end of day a
business day in each branch (`EndOfDayReports` unique by `BranchId` and `Date`), handed in in its
own exact order from its own last closed day (Tanta's next is the day after Tanta's last, whatever
the first branch has closed), its drafts, warnings and stranded drafts its own. So are what a day is
made of:

| What | One a day | In each branch |
| --- | --- | --- |
| The end of day (تقفيل اليوم) | was the company's | the branch worked in's, made in it, named at the top of the page (*Tanta · طنطا*) |
| The day's sales summary | was the company's | the branch's: a second for the same day in the same branch is refused, another branch's is its own |
| The day's takings (the Z report into the safe) | was the company's | the branch's: *The takings of 17 Nov are entered already* only for that branch's |
| What was paid out of the day's takings before they went in | was the company's | the branch's drawer's |
| The POS's day and its Z reports | was the company's | the branch whose till sent them (`PosDays` unique by `BranchId` and `Date`) |

Every lookup of a day by its date is the branch worked in's (the branch chosen at the top of the
screen, or the user's own); by an id (an invoice or a payment handed in) it is any branch's, and an
invoice handed in at one branch's end of day is posted on that branch's daily batch alone (*It was
handed in at another branch's end of day: post it there*). **A manager's undo** of the last closed day
is the branch's: its takings, its sales summary, its till's Z reports and its invoices posted, nothing
of another branch's. **Daily summaries** (Reports) lists the branch's days and its sequence.

**The period lock** moves no further than every branch in use that closes its days has closed: the
earliest of their last closed days (a branch that has never closed a day does not hold it).

**Each branch's till.** A POS key is one branch's (`PosLinks.BranchId`, one a branch; the first
branch's is the key there always was). The key in `X-API-Key` names the branch: its Z reports become
that branch's sales summary and takings, its days that branch's, and its calls that branch's log
(`PosSyncLogs.BranchId`; a call refused for its key is everyone's to see). A report one branch's till
sent is refused from another's (*That Z report was sent by another branch's till*). The menu it reads
is the company's.

The safe is still the company's: each branch's takings go into it. Migration `AddBranchEndOfDay`
(every day, POS day, key and call before is the first branch's).

### The P&L by branch and for the company as a whole (قائمة الدخل للفرع والشركة ككل)

**Reports → KPIs** is the month's P&L (قائمة الدخل). While the company has one branch it is the
company's, as it always was. With several, it is read for **one branch** or for **the company as a
whole · الشركة ككل** (consolidated), chosen in **P&L for · قائمة الدخل لـ** at the top by whoever
works every branch (the company's as a whole by default). A user kept to a branch reads their own
branch's alone: asked for another, the API refuses (403); asked for the whole, it gives theirs.

**A branch's P&L** is its own records at its own costs: its takings, its sales costed at its own
moving average (a branch that bought from the central kitchen at a markup costs what it sells at the
price it paid), its waste, spoilage and count differences, its staff meals and hospitality, its
expense invoices and the vouchers and salaries paid from its safe, its breakage, and **its own
monthly costs**: wages, labour hours, rent, running costs, interest and depreciation are entered on
each branch's P&L (`MonthlyExpenses` by `BranchId`; the first branch's while there is one). With
the other branches:

| Line | Whose | What |
| --- | --- | --- |
| Inter-branch sales · مبيعات داخلية للفروع | The supplying branch | Its internal sales invoices dispatched in the month, at their transfer prices: in its revenue (and its food sales for the food cost %) |
| Cost of goods sent to branches · تكلفة البضاعة المحولة للفروع | The supplying branch | What those goods cost it, at its average as they left: in its cost of sales |
| Transit losses · عجز النقل بين الفروع | The receiving branch | What it was billed for that never arrived, received in the month: in its cost of sales |
| Bought from other branches · مشتريات من الفروع | The receiving branch | Its internal purchase invoices received in the month: said under the statement, never a line of it; the goods went into its stock, and their cost comes in as they are used |

Voided invoices are not counted. A central kitchen with no takings of its own has its internal sales
as its revenue, and its food cost % is what its goods cost it against what it billed for them.

**Company costs (مصروفات على مستوى الشركة)** are what no branch keeps: the month's payroll from HR
and the fixed assets register's depreciation and disposals. They are on the company's P&L, never a
branch's; a branch's says what they are (*Not in a branch's P&L: the company's own costs, payroll
from HR L.E 5,000.00, …, on the consolidated P&L*). With the payroll from HR, a branch's wages are
known (in the company's payroll, said under its wages) and its labour cost % says the payroll is
the company's; the salaries paid from a branch's safe pay that payroll, and are not counted again.

**The company as a whole (consolidated)** is its branches' P&Ls added up, its own costs added, and
what the branches sold and bought each other taken out, so nothing is counted twice:

```
  Σ branches' P&Ls (each at its own costs)
+ Company costs (HR's payroll, the fixed assets register)
− Inter-branch sales (استبعاد المبيعات بين الفروع), out of the revenue
− Inter-branch purchases (استبعاد المشتريات بين الفروع), out of the costs:
    what the goods cost the sending branch (its cost of goods sent)
    the markup the receiving branches paid on what they sold, lost or never received this month
    and on what their staff ate and their guests were given
= Consolidated P&L (قائمة الدخل للشركة ككل)
```

Its EBITDA and net profit wait, as a branch's do, for the wages: for every branch that traded in the
month to have its own in (or the month's payroll from HR), each named (*Enter the wages and benefits
of Main branch and Tanta, each on its own P&L*); one branch without them would flatter the whole.

So the consolidated revenue is the branches' takings alone, and every cost is at **what the goods
cost the company**: a burger sold in Tanta from sauce the kitchen made at L.E 100 a kilo and billed at
L.E 110 costs the company L.E 100 a kilo, whatever Tanta paid. A transit loss is the company's at the
goods' cost. **Markup still on a branch's shelves, or on the road,** is in no P&L until the goods are
used: the consolidated gross profit is lower than the branches' by the margin sent in the month, and
higher by the markup used up in it.

The page shows, for the company as a whole, **Eliminations between branches · الاستبعادات بين الفروع**
(the sales out, the purchases out with their two parts, and what that did to the gross profit) and
**By branch · حسب الفرع**: a column for each branch (its name opens its own P&L), the company's
costs, the eliminations, and the consolidated, which the others add up to, down to revenue, cost of
sales, gross profit, operating expenses, EBITDA and net profit (*—* for a branch whose wages are not
in). Its monthly costs are each branch's added up, read only (*each branch's are entered on its own
P&L*).

**What the company paid (التكلفة على الشركة).** Each branch keeps, beside its moving average, the same
average at what the goods cost the company (`MaterialBranchStocks.CompanyAverageCost`, null while the
two are the same): a shipment received counts at the sending branch's cost as it left, not the
transfer price, and a batch made at the cost of what went into it. Each stock movement where the two
differ keeps what one unit cost the company (`StockMovements.CompanyUnitCost`, null otherwise; a
reversal keeps its original's), which is what the consolidated P&L reads for the markup in what was
sold, lost or used. The company's average of a material is its branches' stock at what it cost the
company. With one branch, or several that never sell to each other, the two are always the same.
Changing a material's unit restates these too, and the quantities and prices on requisitions and
internal invoices.

**The API.** `GET /api/costing/kpis?year=&month=&branchId=` (and `GET /api/costing/reports/pnl`, the
same) gives a branch's with `branchId`, or without it the company's (consolidated with several
branches), with its `scope` (`view`: `Company`, `Branch` or `Consolidated`; the branch; `canChoose`;
the branches to choose from), and for a branch `interBranch` (`sales`, `costOfGoodsSent`, `margin`,
`shipments`, `purchases`, `transitLosses`, `receipts`) and `companyCosts`; for the whole,
`eliminations` (`interBranchSales`, `costOfGoodsSent`, `markupInCostOfSales`, `markupInExpenses`,
`interBranchPurchases`, `grossProfit`), `columns` (`kind`: `Branch`, `CompanyCosts`, `Eliminations`
or `Consolidated`) and `companyCosts`. The statement adds `interBranchSales`,
`interBranchCostOfGoods` and `transitLosses`; the P&L's lines add *Inter-branch sales*, *Cost of goods
sent to branches* and *Transit losses* where there are any. `PUT /api/costing/expenses/{year}/{month}
?branchId=` saves a branch's monthly costs: with several branches a branch must be named (a user kept
to one saves their own), never the company's as a whole (*Choose the branch these costs are for*).
Migration `AddConsolidatedPnl`.

## Period lock and month-end close (إقفال الفترة المحاسبية وتجميد الدفاتر)

Once a month is closed, its figures are the ones reported and audited: nothing dated in it may be
added, changed or voided afterwards. **Settings → Period lock** (a manager's, `settings.manage`)
keeps how far the books are closed, in red:

- **The status.** *All books are locked up to October 31, 2026. No changes allowed before this
  date.* (in English and Arabic), or *No period is locked*; what a lock holds, said under it.
- **Lock a new period (إقفال فترة جديدة).** A day, offered as the latest month's end that can be
  closed (*Month end: 31 Oct 2026*), and **Lock books · إقفال الدفاتر** once the word `LOCK` is
  typed in the box under it (checked by the API too). A lock moves forward only: to a day after
  the one closed, never past today, and never past the last end of day closed (the days after it
  could not be closed any more): with several branches, the day every branch in use that closes its
  days has closed up to. Earlier is an unlock.
- **Temporary unlock (فتح الفترة استثنائياً).** The owner's alone (`settings.unlock-periods`, the
  Manager role here; any other manager sees *Only the owner can open a closed period again*): the
  lock rolled back to an earlier day (*Keep the books closed until*), or lifted altogether, always
  with **the reason (سبب الفتح الاستثنائي)**, 5 to 500 characters. Opened again, the page offers to
  close it again to where it was (*Lock again until 31 Oct 2026*) once the adjustment is done.
- **Audit history (سجل التدقيق).** Under it, every change, the latest first: when, locked or
  unlocked, from which day to which, who, and why.

Every change is a line of the **security audit log** (`costing.SecurityAuditLogs`): added to,
never changed or removed, with the line as it reads, the lock's day before and after, the reason,
who (name and user id) and when:

| Action | Line |
| --- | --- |
| `PeriodLocked` | `PeriodLocked: 31-Oct-2026 by Wagdy` |
| `PeriodUnlocked` | `PeriodUnlocked: rolled back to 30-Sep-2026 by Wagdy. Reason: Auditor adjustment` |
| `PeriodUnlocked` (lifted) | `PeriodUnlocked: lock lifted (was 31-Oct-2026) by Wagdy. Reason: …` |

### The firewall: what a closed day refuses

Whatever writes to the books of money or stock says the business days it writes on, and the days
of the records it changes or voids; if any is on or before the day the books are closed until, the
whole request is refused before anything is done, **423 Locked**:

> Cannot modify records before the locked period (Books closed until 31 Oct 2026): 12 Oct 2026 is
> in it. · لا يمكن تعديل أو إضافة حركات في فترة محاسبية تم إقفالها.

The ProblemDetails carries it as `detail` and `errors[0]` (what the screens show), with
`lockedUntil` and `day` (the earliest day refused).

| What | The day held to the lock |
| --- | --- |
| Purchase invoices: entered, posted, the daily batch, corrected, voided (asked or done, and the approval) | The invoice's date and the takings day it is paid from; a correction, the original's too |
| Paying an invoice | Today and the takings day; on credit, the invoice's own date (the supplier's line is dated by it) |
| Receiving against a purchase order | Today |
| Sales: a sale, the day's sales, the one-day and multi-day Excel imports, a refund, a sale voided | The sale's day (a refund, today as well) |
| The POS's Z report | Its business day, and the day a corrected report moves off |
| End of the day: every entry, photo and payout, handing in, a closed day, moving a draft, the undo | The day (both days of a move) |
| The safe: vouchers (the Z report's takings, payments, transfers, an asset bought), a supplier's opening balance, payroll paid, staff deductions and their voids | The voucher's day and its takings day; payroll paid, today |
| Waste: spoilage, staff meals and hospitality; breakage | Today; breakage, its day |
| Stock counts: posted, opening stock, voided | Today; a void, the day it was posted |
| Production: a batch made, corrected, voided | Today; the batch replaced or voided, its own day |
| Internal transfers: made, voided | Today; a void, the day it was made |
| Inter-branch: a dispatch, a receipt; a dispatch voided; a receipt voided (with its dispatch) | Today; the dispatch's day; the receipt's and the dispatch's days |
| Fixed assets: registered, restated, written off, removed, reinstated | The purchase day (restated: only when its day, cost, life or salvage change, which its depreciation follows), the write-off day |
| A month's figures: its expenses (Reports → KPIs), its manual sales sheet, HR's payroll run | The month's last day: a month is closed once its last day is |
| A manager approving a request | The days of what it does |

Not held, since they are what things are rather than what happened: the menu, recipes, raw
materials, prep items, suppliers, categories, stations, purchase orders, drafts (a draft invoice or
count may still be saved, submitted and discarded; posting it is held), documents attached to an
invoice, settings and users. With the books closed through today, nothing more is entered today.

The POS is answered 423 for a closed day's Z report and the sync log shows it **Refused** with the
reason; a report sent again unchanged is answered *unchanged* as before. HR's payroll run for a
closed month is refused and logged likewise.

**How it is held.** Each command that writes to the books is an `IBooksEntry`: it says the days it
carries (`BooksDays`), that it writes today (`WritesToday`), and an `IBooksDays<T>` looks up the
days of the records it names (the invoice it posts or voids, the sale it refunds, the request it
approves). The MediatR pipeline's `BooksLockBehavior` checks them before the handler, and looks
nothing up while the books are open. The Z report, the payroll run and the undo of the last day
check inside their handlers (`IChecksBooksItself`), where their refusals are logged; a month's
expenses and sales sheet through `BooksGuard`. A test holds every command to one or the other: a
new command that writes to the books cannot be added without saying its days.

**Kept** in `costing.CompanySettings.BooksLockedUntilDate` and `costing.SecurityAuditLogs`
(migration `AddPeriodLockAndSecurityAudit`, which carries a lock set before on Financials over
from `FinancialSettings.BooksLockedUntil`, with the line *PeriodLocked: … by System (carried over
from the earlier books lock)*). `GET /api/settings/period-lock` (`settings.manage`) gives
`lockedUntil`, `today`, `lastClosedDay`, `suggestedUntil` and `history`; `POST
/api/settings/period-lock/lock` takes `{ until, confirmation: "LOCK" }` (`settings.manage`);
`POST /api/settings/period-lock/unlock` takes `{ until, reason }`, `until` null to lift it
(`settings.unlock-periods`). `GET /api/financials/settings` and the end of day's sequence show
`booksLockedUntil` too.

## Company settings and the business day

See [company-settings.md](company-settings.md). A business day starts at the company's hour (4
by default) in its time zone: a sale at 01:30 belongs to the day before.

## The model

Schema `costing` for the system, `identity` for its users. The migrations are applied on start,
and the first start seeds the purchase categories General and General expenses, and the company's
settings from the configuration.
