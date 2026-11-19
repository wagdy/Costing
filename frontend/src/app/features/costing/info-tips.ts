// What each figure on the costing screens is, and how it is worked out, in Arabic and English: the
// text behind the (ⓘ) beside a card's title or a column's heading (InfoTip), so the screens keep only
// the figures. Each is as the server computes it; a change there is a change here.

export interface Bilingual {
  en: string;
  ar: string;
}

export interface InfoTipContent {
  title: Bilingual;
  // الوصف: what it is, and what to do with it.
  what: Bilingual;
  // طريقة الحساب: how it is calculated.
  how: Bilingual;
}

const tip = (title: Bilingual, what: Bilingual, how: Bilingual): InfoTipContent => ({ title, what, how });

export const infoTips = {
  // ---- Purchase price variance ----
  ppvImpact: tip(
    { en: 'Financial impact', ar: 'الأثر المالي للانحراف' },
    {
      en: 'What the price changes of the period cost (or saved) on what was actually bought. Positive: you paid more than the stock was worth before.',
      ar: 'ما كلفته (أو وفّرته) تغيرات الأسعار في الفترة على الكميات المشتراة فعلًا. الموجب يعني أنك دفعت أكثر من قيمة المخزون السابقة.',
    },
    {
      en: '(Latest net price − baseline average) × quantity bought in the period, added up over every material.',
      ar: '(آخر سعر شراء صافي − متوسط السعر السابق) × الكمية المشتراة في الفترة، مجموعًا لكل الخامات.',
    },
  ),
  ppvRising: tip(
    { en: 'Prices up', ar: 'ارتفاع الأسعار' },
    { en: 'How many materials were last bought above the average they came in with.', ar: 'عدد الخامات التي كان آخر سعر شراء لها أعلى من متوسطها السابق.' },
    {
      en: 'Count of materials with latest net − baseline > 0; the badge is the extra paid on them: Σ positive impacts.',
      ar: 'عدد الخامات التي (آخر سعر − المتوسط السابق) > 0، والشارة هي الزيادة المدفوعة عليها: مجموع الآثار الموجبة.',
    },
  ),
  ppvFalling: tip(
    { en: 'Prices down', ar: 'انخفاض الأسعار' },
    { en: 'How many materials were last bought below the average they came in with.', ar: 'عدد الخامات التي كان آخر سعر شراء لها أقل من متوسطها السابق.' },
    {
      en: 'Count of materials with latest net − baseline < 0; the badge is what that saved: Σ negative impacts.',
      ar: 'عدد الخامات التي (آخر سعر − المتوسط السابق) < 0، والشارة هي ما تم توفيره: مجموع الآثار السالبة.',
    },
  ),
  ppvDishes: tip(
    { en: 'Dishes affected', ar: 'الأطباق المتأثرة' },
    { en: 'Menu dishes whose cost per portion went up because an ingredient got dearer.', ar: 'أطباق المنيو التي ارتفعت تكلفة حصتها بسبب ارتفاع سعر أحد مكوناتها.' },
    {
      en: 'Distinct dishes that use a risen material, directly or inside a prep item, by their recipes.',
      ar: 'عدد الأطباق المختلفة التي تستخدم خامة ارتفع سعرها، مباشرة أو داخل صنف مُصنَّع، حسب الوصفات.',
    },
  ),
  ppvLargest: tip(
    { en: 'Largest rise', ar: 'أعلى ارتفاع' },
    { en: 'The material whose price rose most, as a share of what it used to cost.', ar: 'الخامة التي ارتفع سعرها بأعلى نسبة مقارنة بتكلفتها السابقة.' },
    { en: '(Latest net − baseline) ÷ baseline × 100, the highest of the rising materials.', ar: '(آخر سعر − المتوسط السابق) ÷ المتوسط السابق × 100، الأعلى بين الخامات المرتفعة.' },
  ),
  baselineAvg: tip(
    { en: 'Baseline avg', ar: 'متوسط السعر السابق' },
    {
      en: 'The moving average cost the material had on the first day of the period: what its stock was worth a unit before these purchases.',
      ar: 'متوسط التكلفة المتحرك للخامة في أول يوم من الفترة: قيمة الوحدة في المخزون قبل مشتريات الفترة.',
    },
    {
      en: 'Replayed from the stock ledger before the period: each priced delivery averaged in with the stock on the shelf. With no history, the first price paid in the period.',
      ar: 'يُعاد حسابه من دفتر حركة المخزون قبل الفترة: كل توريد مُسعّر يُدمج مع الرصيد الموجود بالمتوسط المرجح. بدون تاريخ سابق: أول سعر مدفوع في الفترة.',
    },
  ),
  latestNet: tip(
    { en: 'Latest net', ar: 'آخر سعر شراء صافي' },
    {
      en: 'The last price paid for a purchase unit in the period, after the invoice discount. Tap a price to open its invoice.',
      ar: 'آخر سعر مدفوع لوحدة الشراء في الفترة بعد خصم الفاتورة. اضغط على السعر لفتح فاتورته.',
    },
    { en: 'Line cost after its share of the discount ÷ quantity bought, per purchase unit.', ar: 'تكلفة السطر بعد نصيبه من الخصم ÷ الكمية المشتراة، لكل وحدة شراء.' },
  ),
  ppvChange: tip(
    { en: 'Change', ar: 'فرق السعر ونسبة التغير' },
    { en: 'How far the latest price moved from the baseline, in money and as a share.', ar: 'مقدار تحرك آخر سعر عن المتوسط السابق، بالقيمة وبالنسبة.' },
    { en: 'Latest net − baseline avg; and that ÷ baseline × 100.', ar: 'آخر سعر صافي − متوسط السعر السابق؛ ثم ÷ المتوسط السابق × 100.' },
  ),
  ppvLineImpact: tip(
    { en: 'Impact', ar: 'الأثر المالي' },
    { en: "What this material's price change cost on the quantity bought in the period.", ar: 'ما كلفه تغير سعر هذه الخامة على الكمية المشتراة في الفترة.' },
    { en: '(Latest net − baseline avg) × quantity bought.', ar: '(آخر سعر صافي − متوسط السعر السابق) × الكمية المشتراة.' },
  ),

  // ---- The order planner ----
  orderApproved: tip(
    { en: 'Approved order', ar: 'الطلبية المعتمدة' },
    { en: 'What the order you approved below will cost, at the latest prices.', ar: 'تكلفة الطلبية التي اعتمدتها في الجدول، بآخر أسعار الشراء.' },
    { en: 'Σ approved quantity × latest net price paid, per material.', ar: 'مجموع (الكمية المعتمدة × آخر سعر شراء صافي) لكل خامة.' },
  ),
  orderSuggested: tip(
    { en: 'Suggested', ar: 'المقترح' },
    { en: 'What the planner suggests ordering, before your changes.', ar: 'ما يقترحه المخطط للطلب قبل تعديلاتك.' },
    {
      en: 'Per material: expected usage + reorder level − on hand, rounded up to whole purchase units; × latest price.',
      ar: 'لكل خامة: الاستهلاك المتوقع + حد الطلب − الرصيد، مقربًا لأعلى لوحدات شراء كاملة؛ × آخر سعر.',
    },
  ),
  orderBelowReorder: tip(
    { en: 'Below reorder level', ar: 'تحت حد الطلب' },
    { en: 'Materials whose stock is already under the level you set for reordering.', ar: 'الخامات التي رصيدها الآن أقل من حد الطلب الذي حددته.' },
    { en: 'Count of materials with on hand < reorder level.', ar: 'عدد الخامات التي الرصيد < حد الطلب.' },
  ),
  orderPlannedFrom: tip(
    { en: 'Planned from', ar: 'مبني على' },
    { en: 'The days covered ahead, and the past days whose sales the plan is built on.', ar: 'أيام التغطية القادمة، والأيام السابقة التي بُنيت الخطة على مبيعاتها.' },
    {
      en: 'Each dish: its sales in the look-back ÷ days, × (1 + growth %) unless you expect otherwise; × days covered; through the recipes and prep items to bought materials.',
      ar: 'لكل طبق: مبيعاته في فترة الرجوع ÷ عدد الأيام × (1 + نسبة النمو) ما لم تحدد توقعًا آخر؛ × أيام التغطية؛ ثم عبر الوصفات والمُصنّعات إلى الخامات.',
    },
  ),
  orderDaily: tip(
    { en: 'A day', ar: 'متوسط الاستهلاك اليومي' },
    { en: 'What the past days used of the material a day, by the sales and the recipes.', ar: 'ما استُهلك من الخامة يوميًا في الأيام السابقة حسب المبيعات والوصفات.' },
    { en: 'Recipe usage of the look-back sales ÷ look-back days, in purchase units.', ar: 'استهلاك الوصفات لمبيعات فترة الرجوع ÷ عدد أيامها، بوحدة الشراء.' },
  ),
  orderExpected: tip(
    { en: 'Expected', ar: 'الاستهلاك المتوقع' },
    { en: 'What the days ahead will need, the prep items already made netted off first.', ar: 'ما ستحتاجه الأيام القادمة، بعد خصم المُصنّعات الجاهزة في المخزون.' },
    { en: 'Σ expected dish sales × recipe quantity (as purchased, yield allowed for) − prep items on hand.', ar: 'مجموع (المبيعات المتوقعة × كمية الوصفة كما تُشترى مع نسبة الصافي) − المُصنّعات المتاحة.' },
  ),
  orderSuggestedQty: tip(
    { en: 'Suggested', ar: 'الكمية المرشحة' },
    { en: 'What to order of this material, in whole purchase units.', ar: 'الكمية المقترح طلبها من الخامة بوحدات شراء كاملة.' },
    { en: 'max(0, expected + reorder level − on hand), rounded up to a whole purchase unit.', ar: 'الأكبر من (0، المتوقع + حد الطلب − الرصيد)، مقربًا لأعلى لوحدة شراء كاملة.' },
  ),

  // ---- Theoretical against actual consumption ----
  unexplainedVariance: tip(
    { en: 'Unexplained variance', ar: 'الانحراف غير المبرر' },
    {
      en: 'Material that left the stores with no sale, recipe or logged waste to explain it: over-portioning, unrecorded waste, theft, or a wrong recipe.',
      ar: 'خامات خرجت من المخزن دون بيع أو وصفة أو هالك مسجل يفسرها: زيادة في الحصص، هالك غير مسجل، سرقة، أو وصفة خاطئة.',
    },
    { en: '(Actual usage − theoretical usage) × average cost now.', ar: '(الاستهلاك الفعلي − الاستهلاك النظري) × متوسط التكلفة الحالي.' },
  ),
  highLoss: tip(
    { en: 'High-loss materials', ar: 'خامات بفاقد مرتفع' },
    { en: 'Materials used beyond the recipes by more than the tolerance: look at these first.', ar: 'الخامات التي تجاوز استهلاكها الوصفات بأكثر من نسبة السماح: ابدأ بها.' },
    { en: 'Count of materials with unexplained ÷ theoretical × 100 > tolerance %.', ar: 'عدد الخامات التي (غير المبرر ÷ النظري × 100) > نسبة السماح.' },
  ),
  theoreticalUsage: tip(
    { en: 'Theoretical usage', ar: 'الاستهلاك النظري' },
    { en: 'What the period’s sales should have taken from the stores, with no waste and no mistakes.', ar: 'ما كان يجب أن تستهلكه مبيعات الفترة من المخزن بدون هالك أو أخطاء.' },
    {
      en: 'Σ dishes sold × recipe quantities, down through the prep items, + what is held in prep items made and not sold yet; at the average cost now.',
      ar: 'مجموع (الأطباق المباعة × كميات الوصفات) عبر المُصنّعات، + ما بقي داخل مُصنّعات لم تُبع بعد؛ بمتوسط التكلفة الحالي.',
    },
  ),
  actualUsage: tip(
    { en: 'Actual usage', ar: 'الاستهلاك الفعلي' },
    { en: 'What really left the stores in the period, by the stock book.', ar: 'ما خرج فعلًا من المخزن خلال الفترة حسب دفتر المخزون.' },
    { en: 'Opening + purchases − logged waste − closing; at the average cost now.', ar: 'أول المدة + المشتريات − الهالك المسجل − آخر المدة؛ بمتوسط التكلفة الحالي.' },
  ),
  theoreticalVsActual: tip(
    { en: 'Theoretical vs actual', ar: 'النظري مقابل الفعلي' },
    {
      en: 'The gap between what the recipes say the sales took and what the stores really lost. Positive: more used than the recipes allow.',
      ar: 'الفرق بين ما تقول الوصفات إن المبيعات استهلكته وما خرج فعلًا من المخزن. الموجب: استهلاك أكثر مما تسمح به الوصفات.',
    },
    { en: 'Unexplained = actual − theoretical; % = unexplained ÷ theoretical × 100.', ar: 'غير المبرر = الفعلي − النظري؛ النسبة = غير المبرر ÷ النظري × 100.' },
  ),

  // ---- ABC and days on hand ----
  classA: tip(
    { en: 'Class A', ar: 'الفئة A' },
    {
      en: 'The few materials that hold most of the money used: count and price them daily, and negotiate them first.',
      ar: 'عدد قليل من الخامات يمثل معظم قيمة الاستهلاك: تُجرد وتُراجع أسعارها يوميًا، وتُفاوض عليها أولًا.',
    },
    {
      en: 'Materials sorted by worth used, largest first; A while the running share is within 75% of the total.',
      ar: 'تُرتب الخامات حسب قيمة الاستهلاك تنازليًا؛ الفئة A ما دامت النسبة التراكمية ضمن 75% من الإجمالي.',
    },
  ),
  classB: tip(
    { en: 'Class B', ar: 'الفئة B' },
    { en: 'The middle of the value: control them weekly.', ar: 'الشريحة الوسطى من القيمة: تُراقب أسبوعيًا.' },
    { en: 'The next materials while the running share is above 75% and within 90%.', ar: 'الخامات التالية ما دامت النسبة التراكمية فوق 75% وحتى 90%.' },
  ),
  classC: tip(
    { en: 'Class C', ar: 'الفئة C' },
    { en: 'Many cheap materials with little of the money: buy in bulk, count less often.', ar: 'خامات كثيرة رخيصة بقيمة قليلة: تُشترى بالجملة وتُجرد على فترات أطول.' },
    { en: 'The rest: running share above 90%.', ar: 'الباقي: النسبة التراكمية فوق 90%.' },
  ),
  abcShare: tip(
    { en: 'Share', ar: 'النسبة · التراكمي' },
    { en: "The material's part of all that was used, and the running total down the list.", ar: 'نصيب الخامة من إجمالي الاستهلاك، والمجموع التراكمي على طول القائمة.' },
    { en: 'Worth used ÷ total worth used × 100; cumulative = Σ shares down to this row.', ar: 'قيمة الاستهلاك ÷ إجمالي قيمة الاستهلاك × 100؛ التراكمي = مجموع النسب حتى هذا السطر.' },
  ),
  abcWorth: tip(
    { en: 'Worth used', ar: 'قيمة الاستهلاك' },
    { en: 'What the material used in the period was worth: sold, made into prep items, wasted, short at a count.', ar: 'قيمة ما استُهلك من الخامة في الفترة: مبيعات وتصنيع وهالك وعجز جرد.' },
    { en: 'Σ quantity of each use × the average cost when it happened.', ar: 'مجموع (كمية كل استهلاك × متوسط التكلفة وقت حدوثه).' },
  ),
  daysOnHand: tip(
    { en: 'Days on hand', ar: 'أيام الكفاية' },
    { en: 'How many days the stock on the shelf lasts at the pace it is used.', ar: 'عدد الأيام التي يكفيها الرصيد الحالي بمعدل الاستهلاك.' },
    { en: 'On hand ÷ average daily usage (worth used ÷ days in the period).', ar: 'الرصيد ÷ متوسط الاستهلاك اليومي (الاستهلاك ÷ عدد أيام الفترة).' },
  ),
  stockoutRisk: tip(
    { en: 'Stockout risk', ar: 'خطر النفاد' },
    { en: 'Materials that will likely run out before the next delivery: order them now.', ar: 'خامات قد تنفد قبل التوريد القادم: اطلبها الآن.' },
    { en: 'Days on hand < 2.', ar: 'أيام الكفاية < 2.' },
  ),
  deadStock: tip(
    { en: 'Dead stock', ar: 'مخزون راكد' },
    {
      en: 'Stock on the shelf that nothing used in the period: cash tied up, and a risk of expiry. The badge is what it is worth.',
      ar: 'مخزون موجود لم يُستهلك منه شيء في الفترة: سيولة مجمدة وخطر انتهاء صلاحية. الشارة هي قيمته.',
    },
    { en: 'On hand > 0 and worth used = 0; value = on hand × average cost.', ar: 'الرصيد > 0 والاستهلاك = 0؛ القيمة = الرصيد × متوسط التكلفة.' },
  ),

  // ---- Materials, prep items and recipes ----
  apUnit: tip(
    { en: 'AP$ / unit', ar: 'تكلفة الشراء للوحدة' },
    {
      en: 'As-purchased cost: what a purchase unit (a kg, a carton) costs in stock now, before trimming and cleaning.',
      ar: 'تكلفة الشراء كما هي: قيمة وحدة الشراء (كيلو، كرتونة) في المخزون الآن قبل التنظيف والتشفية.',
    },
    {
      en: 'The moving weighted average: (stock on hand × its average + quantity bought × price paid) ÷ (on hand + bought), at each priced delivery.',
      ar: 'المتوسط المرجح المتحرك: (الرصيد × متوسطه + الكمية المشتراة × سعرها) ÷ (الرصيد + المشتراة)، عند كل توريد مُسعّر.',
    },
  ),
  yieldPercent: tip(
    { en: 'Yield %', ar: 'نسبة الصافي' },
    { en: 'How much of what is bought is usable after trimming, peeling, boning or cleaning.', ar: 'نسبة ما يصلح للاستخدام مما يُشترى بعد التنظيف أو التقشير أو نزع العظم.' },
    { en: 'Net usable weight ÷ gross weight bought × 100.', ar: 'الوزن الصافي بعد التنظيف ÷ الوزن القائم المشترى × 100.' },
  ),
  epUnit: tip(
    { en: 'EP$ / unit', ar: 'تكلفة الصافي للوحدة' },
    { en: 'Edible-portion cost: what a usable unit really costs once the waste of cleaning is paid for. Recipes are costed by it.', ar: 'تكلفة الجزء الصالح: التكلفة الحقيقية للوحدة بعد احتساب فاقد التنظيف. الوصفات تُحسب بها.' },
    { en: 'AP$ / unit ÷ (yield % ÷ 100).', ar: 'تكلفة الشراء للوحدة ÷ (نسبة الصافي ÷ 100).' },
  ),
  stockValue: tip(
    { en: 'Stock value', ar: 'قيمة المخزون' },
    { en: 'What the stock on the shelf is worth at its average cost.', ar: 'قيمة الرصيد الموجود بمتوسط تكلفته.' },
    { en: 'On hand × AP$ / unit (stock below zero counts as none).', ar: 'الرصيد × تكلفة الشراء للوحدة (الرصيد السالب يُحسب صفرًا).' },
  ),
  lastPrice: tip(
    { en: 'Last price paid', ar: 'آخر سعر' },
    { en: 'The net price of the latest invoice that bought it, to compare with the average.', ar: 'السعر الصافي لآخر فاتورة اشترته، للمقارنة بالمتوسط.' },
    { en: 'Latest posted invoice line: cost after discount ÷ quantity, per purchase unit.', ar: 'آخر سطر فاتورة مرحّل: التكلفة بعد الخصم ÷ الكمية، لكل وحدة شراء.' },
  ),
  prepStandard: tip(
    { en: 'By its recipe', ar: 'التكلفة المعيارية' },
    { en: 'What a unit of the prep item should cost by its recipe at today’s prices.', ar: 'ما يجب أن تكلفه وحدة المُصنَّع حسب وصفته بأسعار اليوم.' },
    { en: 'Σ ingredient quantity × EP$ of each ÷ the batch yield.', ar: 'مجموع (كمية كل مكون × تكلفته الصافية) ÷ ناتج الدفعة.' },
  ),
  prepAverage: tip(
    { en: 'In stock at', ar: 'متوسط التكلفة' },
    { en: 'What a unit of the prep item in stock cost, from the batches actually made.', ar: 'تكلفة وحدة المُصنَّع في المخزون من الدفعات المصنعة فعلًا.' },
    { en: 'Moving average of the batches: (on hand × average + batch cost) ÷ (on hand + quantity made).', ar: 'المتوسط المتحرك للدفعات: (الرصيد × المتوسط + تكلفة الدفعة) ÷ (الرصيد + الكمية المصنعة).' },
  ),
  costPerPortion: tip(
    { en: 'Cost per portion', ar: 'تكلفة الحصة' },
    { en: 'What one portion of the dish costs to make, its share of the shared costs (oil, gas, boxes) included.', ar: 'تكلفة إعداد حصة واحدة من الطبق، شاملة نصيبها من التكاليف المشتركة (زيت، غاز، علب).' },
    { en: '(Σ ingredient quantity × EP$ / unit) ÷ portions + shared cost per meal.', ar: '(مجموع كمية كل مكون × تكلفته الصافية) ÷ عدد الحصص + التكلفة المشتركة لكل وجبة.' },
  ),
  foodCostPercent: tip(
    { en: 'Food cost %', ar: 'نسبة تكلفة الطعام' },
    { en: 'The share of the selling price that goes on ingredients. Above the target eats into the profit.', ar: 'نسبة سعر البيع التي تذهب للمكونات. تجاوز المستهدف يقلل الربح.' },
    { en: 'Cost per portion ÷ selling price (before VAT) × 100.', ar: 'تكلفة الحصة ÷ سعر البيع (قبل الضريبة) × 100.' },
  ),
  costPerRecipe: tip(
    { en: 'Cost per recipe', ar: 'تكلفة الوصفة' },
    { en: 'What the whole recipe costs, all its portions.', ar: 'تكلفة الوصفة كاملة بكل حصصها.' },
    { en: 'Σ ingredient quantity × EP$ / unit.', ar: 'مجموع (كمية كل مكون × تكلفته الصافية للوحدة).' },
  ),
  marginPerPortion: tip(
    { en: 'Margin per portion', ar: 'هامش الحصة' },
    { en: 'What a portion leaves after its food cost, towards wages, rent and profit.', ar: 'ما تتركه الحصة بعد تكلفتها لتغطية الرواتب والإيجار والربح.' },
    { en: 'Selling price − cost per portion.', ar: 'سعر البيع − تكلفة الحصة.' },
  ),
  foodCostBudget: tip(
    { en: 'Food cost % budget', ar: 'نسبة التكلفة المستهدفة' },
    { en: 'The food cost the restaurant aims at, set in Cost settings.', ar: 'نسبة التكلفة التي يستهدفها المطعم، من إعدادات التكاليف.' },
    { en: 'Set by the manager; the ideal price is worked out from it.', ar: 'يحددها المدير؛ ويُحسب منها السعر المثالي.' },
  ),
  idealPrice: tip(
    { en: 'Ideal selling price', ar: 'سعر البيع المثالي' },
    { en: 'The price that brings the dish to the food cost target.', ar: 'السعر الذي يجعل تكلفة الطبق عند النسبة المستهدفة.' },
    { en: 'Cost per portion ÷ (food cost target % ÷ 100).', ar: 'تكلفة الحصة ÷ (النسبة المستهدفة ÷ 100).' },
  ),
  portions: tip(
    { en: 'Portions', ar: 'عدد الحصص' },
    { en: 'How many portions the recipe makes.', ar: 'عدد الحصص التي تنتجها الوصفة.' },
    { en: 'Entered on the recipe; the cost per portion divides by it.', ar: 'يُدخل في الوصفة؛ وتُقسم عليه تكلفة الوصفة.' },
  ),
  sellingPrice: tip(
    { en: 'Selling price', ar: 'سعر البيع' },
    { en: 'The menu price, or the planned price of a recipe not on the menu yet.', ar: 'سعر المنيو، أو السعر المخطط لوصفة غير مرتبطة بالمنيو بعد.' },
    { en: 'Before VAT, as the menu holds it.', ar: 'قبل الضريبة كما هو في المنيو.' },
  ),

  // ---- Spending and the safe ----
  totalSpent: tip(
    { en: 'Total spent', ar: 'إجمالي المشتريات' },
    { en: 'Everything the posted purchase invoices and expense vouchers cost in these days.', ar: 'إجمالي تكلفة فواتير الشراء المرحّلة وأذون الصرف في هذه الأيام.' },
    { en: 'Σ priced invoice lines after discount + Σ expense vouchers, by invoice date.', ar: 'مجموع سطور الفواتير المسعّرة بعد الخصم + مجموع أذون الصرف، حسب تاريخ الفاتورة.' },
  ),
  stockSpend: tip(
    { en: 'Into stock', ar: 'خامات' },
    { en: 'What was bought into the stores: cost of sales once the recipes use it.', ar: 'ما اشتُري للمخزن: يصبح تكلفة مبيعات عند استخدامه في الوصفات.' },
    { en: 'Σ priced lines of stock materials.', ar: 'مجموع السطور المسعّرة للخامات المخزنية.' },
  ),
  expenseSpend: tip(
    { en: 'Expenses', ar: 'مصروفات' },
    { en: "Overheads that never enter stock: they go to the KPIs' profit and loss.", ar: 'مصروفات عامة لا تدخل المخزن: تذهب لقائمة الأرباح والخسائر في المؤشرات.' },
    { en: 'Σ expense lines + expense vouchers.', ar: 'مجموع سطور المصروفات + أذون الصرف.' },
  ),
  invoices: tip(
    { en: 'Invoices', ar: 'الفواتير' },
    { en: 'How many supplier invoices were posted in these days.', ar: 'عدد فواتير الموردين المرحّلة في هذه الأيام.' },
    { en: 'Count of posted invoices dated in the period.', ar: 'عدد الفواتير المرحّلة المؤرخة في الفترة.' },
  ),
  categoryShare: tip(
    { en: 'Share', ar: 'النسبة' },
    { en: 'The part of everything spent that went to this category.', ar: 'نصيب هذه الفئة من إجمالي الإنفاق.' },
    { en: 'Category total ÷ total spent × 100.', ar: 'إجمالي الفئة ÷ إجمالي الإنفاق × 100.' },
  ),
  openingBalance: tip(
    { en: 'Opening balance', ar: 'الرصيد الافتتاحي' },
    { en: 'What was in the safe when the first day began.', ar: 'ما كان في الخزنة في بداية أول يوم.' },
    { en: 'Σ every safe entry before the first day.', ar: 'مجموع كل حركات الخزنة قبل أول يوم.' },
  ),
  totalIn: tip(
    { en: 'Total in', ar: 'إجمالي الوارد' },
    {
      en: 'Everything the safe had to work with: the balance brought forward and all that came in these days.',
      ar: 'كل ما توفر للخزنة: الرصيد المرحّل وكل ما دخلها في هذه الأيام.',
    },
    {
      en: 'Opening balance + cash sales + Visa sales + tax collected + external funding.',
      ar: 'الرصيد الافتتاحي + مبيعات الكاش + مبيعات الفيزا + الضريبة المحصلة + التمويل الخارجي.',
    },
  ),
  totalOut: tip(
    { en: 'Total out', ar: 'إجمالي المنصرف' },
    { en: 'Cash paid out of the safe in these days: suppliers, expenses, staff.', ar: 'النقد المصروف من الخزنة في هذه الأيام: موردين ومصروفات وموظفين.' },
    { en: 'Σ payments out of the safe in the period: suppliers, expense vouchers, staff, tax paid.', ar: 'مجموع المدفوعات من الخزنة في الفترة: موردين وأذون صرف وموظفين وضرائب.' },
  ),
  netCashFlow: tip(
    { en: 'Net cash flow', ar: 'صافي التدفق النقدي' },
    { en: 'Whether the safe gained or lost cash over these days.', ar: 'هل زاد نقد الخزنة أم نقص خلال هذه الأيام.' },
    { en: 'Total in − opening balance − total out.', ar: 'إجمالي الوارد − الرصيد الافتتاحي − إجمالي المنصرف.' },
  ),
  closingBalance: tip(
    { en: 'Closing balance', ar: 'الرصيد الختامي' },
    { en: 'What should be in the safe at the end of the last day.', ar: 'ما يجب أن يكون في الخزنة في نهاية آخر يوم.' },
    { en: 'Total in (the opening balance in it) − total out.', ar: 'إجمالي الوارد (ومنه الرصيد الافتتاحي) − إجمالي المنصرف.' },
  ),

  // ---- The theoretical cost and the variance between counts ----
  theoreticalCost: tip(
    { en: 'Theoretical cost', ar: 'التكلفة النظرية' },
    { en: 'What the sales should have cost by their recipes, with no waste and no mistakes.', ar: 'ما كان يجب أن تكلفه المبيعات حسب وصفاتها بدون هالك أو أخطاء.' },
    {
      en: 'Σ the ingredients each sale took at its cost then (today’s for one sold before its recipe) + its shared cost per meal.',
      ar: 'مجموع المكونات التي أخذها كل بيع بتكلفتها وقتها (وبأسعار اليوم لما بيع قبل وصفته) + التكلفة المشتركة لكل وجبة.',
    },
  ),
  breakEven: tip(
    { en: 'Break-even analysis', ar: 'تحليل نقطة التعادل' },
    {
      en: 'The sales the restaurant needs to cover all its costs, and what each scenario does to it.',
      ar: 'المبيعات اللازمة لتغطية كل التكاليف، وأثر كل سيناريو عليها.',
    },
    {
      en: "Income statement from the days of sales, at a year's pace (weekly × 52); costs from the months' entered costs × 12. Break-even sales = fixed costs ÷ (1 − cost of sales ÷ revenue).",
      ar: 'قائمة الدخل من أيام المبيعات بمعدل سنوي (الأسبوع × 52)؛ والتكاليف من تكاليف الشهور المدخلة × 12. مبيعات التعادل = التكاليف الثابتة ÷ (1 − تكلفة المبيعات ÷ الإيرادات).',
    },
  ),
  netVariance: tip(
    { en: 'Net variance', ar: 'صافي قيمة الانحراف' },
    { en: 'The worth of what was used beyond (or under) the recipes between the two counts, waste included.', ar: 'قيمة ما استُهلك زيادة (أو نقصًا) عن الوصفات بين الجردين، شاملًا الهالك.' },
    { en: 'Σ (actual usage − standard usage) × unit cost.', ar: 'مجموع (الاستهلاك الفعلي − المعياري) × تكلفة الوحدة.' },
  ),
  recordedWaste: tip(
    { en: 'Recorded waste', ar: 'الهالك المسجل' },
    { en: 'The waste someone logged between the counts: it explains part of the variance.', ar: 'الهالك الذي سُجل بين الجردين: يفسر جزءًا من الانحراف.' },
    { en: 'Σ spoilage and voided dishes × their cost.', ar: 'مجموع التالف والأطباق الملغاة × تكلفتها.' },
  ),
  unexplainedBetweenCounts: tip(
    { en: 'Unexplained', ar: 'غير مبرر' },
    { en: 'The variance no recorded waste covers: what to investigate.', ar: 'الانحراف الذي لا يغطيه الهالك المسجل: ما يجب التحقيق فيه.' },
    { en: 'Net variance − recorded waste.', ar: 'صافي الانحراف − الهالك المسجل.' },
  ),
  unfavourable: tip(
    { en: 'Unfavourable materials', ar: 'خامات غير مواتية' },
    { en: 'Materials used beyond the recipes by more than the tolerance.', ar: 'الخامات التي تجاوز استهلاكها الوصفات بأكثر من نسبة السماح.' },
    { en: 'Count of materials with variance ÷ standard usage × 100 > tolerance %.', ar: 'عدد الخامات التي (الانحراف ÷ المعياري × 100) > نسبة السماح.' },
  ),
  largestVariance: tip(
    { en: 'Largest variance', ar: 'أكبر انحراف نسبي' },
    { en: 'The material furthest from its recipes, as a share of its standard usage.', ar: 'الخامة الأبعد عن وصفاتها كنسبة من استهلاكها المعياري.' },
    { en: 'max(variance ÷ standard usage × 100).', ar: 'أعلى قيمة لـ (الانحراف ÷ الاستهلاك المعياري × 100).' },
  ),
  standardUsage: tip(
    { en: 'Standard usage', ar: 'الاستهلاك المعياري' },
    { en: 'What the sales between the counts should have used, by the recipes.', ar: 'ما كان يجب أن تستهلكه المبيعات بين الجردين حسب الوصفات.' },
    { en: 'Σ dishes sold × recipe quantity as purchased.', ar: 'مجموع (الأطباق المباعة × كمية الوصفة كما تُشترى).' },
  ),

  // ---- KPIs ----
  kpiFoodCost: tip(
    { en: 'Food cost %', ar: 'نسبة تكلفة الطعام' },
    { en: 'How well food is bought and prepared: the share of food sales spent on its ingredients.', ar: 'كفاءة شراء الطعام وتحضيره: نسبة مبيعات الطعام التي تذهب لمكوناته.' },
    { en: 'Cost of raw materials consumed ÷ food sales × 100.', ar: '(تكلفة المواد الخام المستهلكة ÷ إجمالي مبيعات الطعام) × 100.' },
  ),
  kpiBeverageCost: tip(
    { en: 'Beverage cost %', ar: 'نسبة تكلفة المشروبات' },
    { en: 'How well drinks are managed.', ar: 'كفاءة إدارة المشروبات.' },
    { en: 'Cost of beverages sold ÷ beverage revenue × 100.', ar: '(تكلفة المشروبات المباعة ÷ إيرادات المشروبات) × 100.' },
  ),
  kpiLabourCost: tip(
    { en: 'Labour cost %', ar: 'نسبة تكلفة العمالة' },
    { en: 'Staffing against revenue.', ar: 'تكلفة العمالة مقارنة بالإيرادات.' },
    { en: 'Wages and benefits ÷ revenue × 100.', ar: '(إجمالي الرواتب والمزايا ÷ إجمالي الإيرادات) × 100.' },
  ),
  kpiAverageCheck: tip(
    { en: 'Average check', ar: 'متوسط قيمة الفاتورة' },
    { en: 'What a customer spends on average.', ar: 'متوسط ما ينفقه العميل.' },
    { en: 'Revenue ÷ paid orders.', ar: 'إجمالي الإيرادات ÷ عدد الفواتير.' },
  ),
  kpiSalesPerLabourHour: tip(
    { en: 'Sales per labour hour', ar: 'الإيراد لكل ساعة عمل' },
    { en: 'How productive the staff hours are.', ar: 'إنتاجية ساعات عمل الموظفين.' },
    { en: 'Revenue ÷ labour hours.', ar: 'إجمالي المبيعات ÷ إجمالي ساعات العمل.' },
  ),
  kpiGrossProfitMargin: tip(
    { en: 'Gross profit margin', ar: 'هامش الربح الإجمالي' },
    { en: 'What the sales leave after the cost of what was sold.', ar: 'ما تتركه المبيعات بعد تكلفة ما بيع.' },
    { en: 'Gross profit (revenue − cost of sales) ÷ revenue × 100.', ar: '(إجمالي الربح ÷ إجمالي الإيرادات) × 100، والربح الإجمالي = الإيرادات − تكلفة المبيعات.' },
  ),
  kpiNetProfitMargin: tip(
    { en: 'Net profit margin', ar: 'هامش الربح الصافي' },
    { en: 'What is left as profit of every pound sold, after every cost.', ar: 'ما يتبقى ربحًا من كل جنيه مبيعات بعد كل التكاليف.' },
    { en: 'Net profit ÷ revenue × 100.', ar: '(صافي الربح ÷ الإيرادات) × 100.' },
  ),
  incomeStatement: tip(
    { en: 'The month', ar: 'قائمة الدخل' },
    {
      en: "The month's profit and loss: revenue is its net sales, the tax collected on the takings is owed to the tax authority and never profit.",
      ar: 'أرباح وخسائر الشهر: الإيراد هو صافي المبيعات، والضريبة المحصلة التزام على المطعم وليست ربحًا.',
    },
    {
      en: 'Revenue = takings (cash + Visa) − tax collected. Food and beverage cost: what the sales took by their recipes, shared costs on the meals, losses against food. Expenses: the posted invoices by category, with what is entered by hand.',
      ar: 'الإيراد = الإيرادات (كاش + فيزا) − الضريبة المحصلة. تكلفة الطعام والمشروبات: ما أخذته المبيعات حسب الوصفات مع التكاليف المشتركة، والفاقد على الطعام. المصروفات: فواتير الشراء المرحّلة حسب القسم مع المدخل يدويًا.',
    },
  ),
  dishProfit: tip(
    { en: 'Margin', ar: 'الهامش' },
    { en: 'What the dish left of its sales after its ingredients this month.', ar: 'ما تركه الطبق من مبيعاته بعد مكوناته هذا الشهر.' },
    { en: 'Profit = net sales − ingredient cost; margin = profit ÷ net sales × 100.', ar: 'الربح = صافي المبيعات − تكلفة المكونات؛ الهامش = الربح ÷ صافي المبيعات × 100.' },
  ),

  // ---- Menu engineering ----
  meStar: tip(
    { en: 'Stars', ar: 'النجوم' },
    {
      en: 'Popular and profitable: keep them as they are, give them the best place on the menu, and never let their quality or portion slip.',
      ar: 'مطلوبة ومربحة: حافظ عليها كما هي، وضعها في أبرز مكان بالمنيو، ولا تسمح بتراجع جودتها أو حجم حصتها.',
    },
    { en: 'Menu mix ≥ popularity threshold, and contribution margin ≥ the average margin.', ar: 'نسبة المبيعات ≥ حد الشعبية، وهامش المساهمة ≥ متوسط الهامش.' },
  ),
  mePlowhorse: tip(
    { en: 'Plowhorses', ar: 'خيول العمل' },
    {
      en: 'Popular but earn little: raise the price a little at a time, cut the portion cost or the dearer ingredients, or pair them with a high-margin side.',
      ar: 'مطلوبة لكن ربحها قليل: ارفع السعر تدريجيًا، أو خفّض تكلفة الحصة والمكونات الغالية، أو قدّمها مع صنف جانبي عالي الربح.',
    },
    { en: 'Menu mix ≥ popularity threshold, contribution margin < the average margin.', ar: 'نسبة المبيعات ≥ حد الشعبية، وهامش المساهمة < متوسط الهامش.' },
  ),
  mePuzzle: tip(
    { en: 'Puzzles', ar: 'الألغاز' },
    {
      en: 'Profitable but few order them: move them up the menu, rename or describe them better, have the staff suggest them, or lower the price a little.',
      ar: 'مربحة لكن قليلة الطلب: انقلها لمكان أبرز في المنيو، حسّن اسمها ووصفها، اجعل الموظفين يقترحونها، أو خفّض سعرها قليلًا.',
    },
    { en: 'Menu mix < popularity threshold, contribution margin ≥ the average margin.', ar: 'نسبة المبيعات < حد الشعبية، وهامش المساهمة ≥ متوسط الهامش.' },
  ),
  meDog: tip(
    { en: 'Dogs', ar: 'الأصناف الضعيفة' },
    {
      en: 'Neither popular nor profitable: take them off the menu, or rework them into something new; keep one only if it brings guests in for others.',
      ar: 'غير مطلوبة وغير مربحة: احذفها من المنيو أو أعد تصميمها كصنف جديد؛ أبقِ عليها فقط إن كانت تجذب الزبائن لأصناف أخرى.',
    },
    { en: 'Menu mix < popularity threshold, contribution margin < the average margin.', ar: 'نسبة المبيعات < حد الشعبية، وهامش المساهمة < متوسط الهامش.' },
  ),
  menuMix: tip(
    { en: 'Menu mix %', ar: 'نسبة المبيعات' },
    { en: "The dish's share of all the portions sold of the dishes analysed.", ar: 'نصيب الطبق من إجمالي الحصص المباعة للأطباق محل التحليل.' },
    { en: 'Quantity sold ÷ Σ quantity sold of every analysed dish × 100.', ar: 'الكمية المباعة ÷ مجموع الكميات المباعة لكل الأطباق × 100.' },
  ),
  popularityThreshold: tip(
    { en: 'Popularity threshold', ar: 'حد الشعبية' },
    { en: 'The menu mix a dish must reach to count as popular.', ar: 'نسبة المبيعات التي يجب أن يبلغها الطبق ليُعتبر مطلوبًا.' },
    { en: '70% × (100% ÷ number of dishes analysed), as Kasavana and Smith set it.', ar: '70% × (100% ÷ عدد الأطباق محل التحليل)، حسب طريقة كاسافانا وسميث.' },
  ),
  contributionMargin: tip(
    { en: 'Contribution margin', ar: 'هامش المساهمة' },
    { en: 'What one portion leaves after its food cost, towards the other costs and the profit.', ar: 'ما تتركه الحصة الواحدة بعد تكلفة طعامها لتغطية باقي التكاليف والربح.' },
    { en: 'Average net selling price − food cost per portion (ingredients as sold).', ar: 'متوسط سعر البيع الصافي − تكلفة طعام الحصة (المكونات وقت البيع).' },
  ),
  averageContribution: tip(
    { en: 'Average margin', ar: 'متوسط هامش المساهمة' },
    { en: 'The margin a dish must reach to count as profitable.', ar: 'الهامش الذي يجب أن يبلغه الطبق ليُعتبر مربحًا.' },
    { en: 'Σ total contribution ÷ Σ quantity sold (weighted by what sold).', ar: 'مجموع المساهمة الكلية ÷ مجموع الكميات المباعة (متوسط مرجح بالمبيعات).' },
  ),
  totalContribution: tip(
    { en: 'Total contribution', ar: 'إجمالي المساهمة' },
    { en: 'What the dish earned over its food cost in the period: where the profit really comes from.', ar: 'ما ربحه الطبق فوق تكلفة طعامه في الفترة: مصدر الربح الحقيقي.' },
    { en: 'Net sales − ingredient cost = contribution margin × quantity sold.', ar: 'صافي المبيعات − تكلفة المكونات = هامش المساهمة × الكمية المباعة.' },
  ),
  suggestedPrice: tip(
    { en: 'Suggested price', ar: 'السعر المقترح' },
    { en: 'The price that brings the dish to the food cost target.', ar: 'السعر الذي يجعل تكلفة الطبق عند النسبة المستهدفة.' },
    { en: 'Food cost per portion ÷ (food cost target % ÷ 100).', ar: 'تكلفة طعام الحصة ÷ (النسبة المستهدفة ÷ 100).' },
  ),
  meFoodCost: tip(
    { en: 'Food cost %', ar: 'نسبة تكلفة الطعام' },
    { en: 'The share of what the dish sold for that went on its ingredients in the period.', ar: 'نسبة ما بيع به الطبق التي ذهبت لمكوناته في الفترة.' },
    { en: 'Ingredient cost ÷ net sales × 100.', ar: 'تكلفة المكونات ÷ صافي المبيعات × 100.' },
  ),

  // ---- Stock counts ----
  countOpening: tip(
    { en: 'Opening stock', ar: 'جرد افتتاحي' },
    {
      en: "Once per material, when costing starts: where its stock begins, at the cost it has. No shortage or surplus is recorded and nothing goes into the profit.",
      ar: 'مرة واحدة لكل خامة عند بدء التكاليف: رصيد البداية بتكلفته. لا يُسجل عجز أو زيادة ولا أثر على الأرباح.',
    },
    { en: 'Stock set to what was counted, posted as OpeningStock, not as a count adjustment.', ar: 'يُضبط الرصيد على المجرود ويُرحّل كرصيد افتتاحي لا كتسوية جرد.' },
  ),
  countFull: tip(
    { en: 'Full periodic count', ar: 'جرد دوري شامل' },
    {
      en: 'Every material, weekly, at the same point, with the kitchen closed. What it finds against the records is a shortage or a surplus, and the variance report measures between counts.',
      ar: 'كل الخامات أسبوعيًا في نفس التوقيت والمطبخ مغلق. الفرق عن الرصيد الدفتري عجز أو زيادة، ويقيس تقرير الانحراف بين جردين.',
    },
    { en: 'For each material counted: adjustment = counted − book, valued at the average cost then.', ar: 'لكل خامة مجرودة: التسوية = المجرود − الدفتري، بمتوسط التكلفة وقتها.' },
  ),
  countSpot: tip(
    { en: 'Daily spot count', ar: 'جرد يومي سريع / جزئي' },
    {
      en: 'A few materials, every day: the critical items starred, the class-A ones, those that ran short. A theft or an unrecorded waste shows the next day, not at the end of the week.',
      ar: 'خامات قليلة يوميًا: الأصناف الحرجة المحددة، أو الفئة A، أو الأكثر انحرافًا. السرقة أو الهالك غير المسجل يظهر في اليوم التالي لا في نهاية الأسبوع.',
    },
    {
      en: 'Only the materials counted in it are adjusted (counted − book); every other material keeps its stock exactly.',
      ar: 'تُسوّى الخامات المجرودة فيه فقط (المجرود − الدفتري)، وباقي الخامات يبقى رصيدها كما هو تمامًا.',
    },
  ),
  countBlind: tip(
    { en: 'Blind count mode', ar: 'وضع الجرد الأعمى' },
    {
      en: 'The counter never sees what the records expect, so they weigh rather than copy the book. A storekeeper always counts blind and hands the count in; a manager or cost controller reconciles and posts it.',
      ar: 'لا يرى من يجرد الرصيد الدفتري فيزن بدل أن ينقل الرقم. أمين المخزن يجرد دائمًا بشكل أعمى ويسلم الجرد للمراجعة، والمدير أو مراقب التكاليف يطابق ويرحّل.',
    },
    {
      en: 'Hidden while counting: the book quantity, the difference, the unit cost and its value — left out by the server too, not only the screen.',
      ar: 'مخفي أثناء الجرد: الرصيد الدفتري والفرق وتكلفة الوحدة وقيمتها — يحذفها الخادم نفسه لا الشاشة فقط.',
    },
  ),
  countVarianceValue: tip(
    { en: 'Variance value', ar: 'قيمة الفرق' },
    { en: 'What the shortage or surplus is worth. Red: short beyond the tolerance; amber: over it.', ar: 'قيمة العجز أو الزيادة. أحمر: عجز يتجاوز نسبة السماح؛ كهرماني: زيادة تتجاوزها.' },
    { en: '(Counted − book) × average cost per unit; flagged when |counted − book| ÷ book × 100 > tolerance %.', ar: '(المجرود − الدفتري) × متوسط تكلفة الوحدة؛ ويُعلّم إذا تجاوز |الفرق| ÷ الدفتري × 100 نسبة السماح.' },
  ),

  // ---- Supplier accounts ----
  apTotal: tip(
    { en: 'Total owed to suppliers', ar: 'إجمالي مديونيات الموردين' },
    { en: 'All that is owed to suppliers on the day, by how long it has been due: pay the oldest first and plan the week\'s cash.', ar: 'كل ما على المطعم للموردين في هذا اليوم حسب عمر الدين: سدد الأقدم أولًا وخطط سيولة الأسبوع.' },
    { en: 'Opening debt + credit invoices − payments, each supplier; payments settle the oldest first.', ar: 'الرصيد السابق + الفواتير الآجلة − المسدد لكل مورد؛ والسداد يُخصم من الأقدم أولًا.' },
  ),
  apCurrent: tip(
    { en: 'Current (not due)', ar: 'غير مستحق بعد' },
    { en: 'Invoices still within the supplier\'s payment terms.', ar: 'فواتير ما زالت داخل مدة السداد المتفق عليها مع المورد.' },
    { en: 'Due date = invoice date + the supplier\'s payment terms (days); not due while that day has not passed.', ar: 'تاريخ الاستحقاق = تاريخ الفاتورة + مدة السداد بالأيام؛ غير مستحق ما لم يمر هذا اليوم.' },
  ),
  apPastDue: tip(
    { en: 'Days past due', ar: 'أيام التأخير' },
    { en: 'What is left of each invoice after its due date, by how late it is: the older, the more pressing.', ar: 'ما تبقى من كل فاتورة بعد تاريخ استحقاقها حسب مدة التأخير: الأقدم هو الأكثر إلحاحًا.' },
    { en: 'Days late = the day − the due date: 1–30, 31–60, 61–90, 90+. What was owed before the treasury is due from when it was entered.', ar: 'أيام التأخير = اليوم − تاريخ الاستحقاق: 1–30، 31–60، 61–90، أكثر من 90. والرصيد السابق مستحق من تاريخ إدخاله.' },
  ),
  stOpening: tip(
    { en: 'Opening balance owed', ar: 'رصيد أول المدة' },
    { en: 'What was owed to the supplier when the first day began.', ar: 'ما كان مستحقًا للمورد في بداية أول يوم.' },
    { en: 'Σ every credit invoice, opening debt and payment before the first day.', ar: 'مجموع الفواتير الآجلة والرصيد السابق والمدفوعات قبل أول يوم.' },
  ),
  stClosing: tip(
    { en: 'Closing balance owed', ar: 'الرصيد المستحق حالياً' },
    { en: 'What is owed at the end of the last day: the running balance of the last line.', ar: 'المستحق في نهاية آخر يوم: الرصيد التراكمي لآخر سطر.' },
    { en: 'Opening + credit invoices − payments; a cash invoice is owed and paid at once, so it leaves the balance as it was.', ar: 'رصيد أول المدة + الفواتير الآجلة − المسدد؛ والفاتورة النقدية مستحقة ومسددة معًا فلا تغير الرصيد.' },
  ),

  // ---- Vendor prices ----
  vpBest: tip(
    { en: 'Best price', ar: 'الأقل سعراً' },
    { en: 'The supplier whose last net price for it is the lowest: the order planner can send each material to it.', ar: 'المورد صاحب أقل سعر صافٍ أخير للخامة: ويمكن لمخطط الطلبيات توجيه الطلب إليه.' },
    { en: 'Net price = line total − its discount − its share of the invoice\'s discount, ÷ quantity, per purchase unit.', ar: 'السعر الصافي = قيمة السطر − خصمه − نصيبه من خصم الفاتورة، ÷ الكمية، لوحدة الشراء.' },
  ),
  vpAverage: tip(
    { en: 'Weighted average price', ar: 'المتوسط المرجح للسعر' },
    { en: 'What a unit cost on average from this supplier over the period, the larger purchases counting more.', ar: 'متوسط سعر الوحدة من هذا المورد خلال الفترة، والكميات الأكبر تؤثر أكثر.' },
    { en: 'Σ net cost ÷ Σ quantity, per purchase unit.', ar: 'مجموع التكلفة الصافية ÷ مجموع الكمية، لوحدة الشراء.' },
  ),
  vpSpread: tip(
    { en: 'Price spread', ar: 'فرق الأسعار' },
    { en: 'How much dearer the dearest supplier\'s last price is than the cheapest\'s: where switching saves most.', ar: 'كم يزيد آخر سعر لأغلى مورد عن أرخصهم: حيث يوفر التغيير أكثر.' },
    { en: '(Highest last price ÷ lowest last price − 1) × 100.', ar: '(أعلى سعر أخير ÷ أقل سعر أخير − 1) × 100.' },
  ),

  // ---- Staff meals & hospitality ----
  smStaff: tip(
    { en: 'Staff meals', ar: 'وجبات العاملين' },
    { en: 'What the staff ate, at the cost when taken: a benefit of the staff, in the labor cost on the KPIs, never the kitchen\'s loss.', ar: 'ما أكله العاملون بتكلفته وقت الأخذ: ميزة للعاملين تُحسب ضمن تكلفة العمالة في المؤشرات، وليست هالكًا للمطبخ.' },
    { en: 'Σ quantity × average cost at the time; a dish takes its recipe\'s ingredients as a sale does. Over the daily budget: flagged.', ar: 'مجموع الكمية × متوسط التكلفة وقتها؛ والطبق يأخذ مكونات وصفته كالمبيعات. وما يتجاوز الحد اليومي يُعلَّم.' },
  ),
  smHospitality: tip(
    { en: 'Hospitality & tastings', ar: 'الضيافة وتجارب الوصفات' },
    { en: 'Given to guests on the house, or used trying recipes: costs of their own on the P&L, not food cost and not loss.', ar: 'ما قُدم للضيوف مجانًا أو استُخدم في تجربة الوصفات: تكاليف مستقلة في قائمة الدخل، ليست تكلفة طعام ولا هالكًا.' },
    { en: 'Σ quantity × average cost at the time.', ar: 'مجموع الكمية × متوسط التكلفة وقتها.' },
  ),
  smUnexplained: tip(
    { en: 'Staff meals & hospitality', ar: 'وجبات العاملين والضيافة' },
    { en: 'Taken on purpose and logged: set apart from the waste, so the unexplained variance is only what no record explains.', ar: 'مأخوذ عمدًا ومسجل: يُفصل عن الهالك، فيبقى الانحراف غير المفسر هو ما لا يفسره أي سجل فقط.' },
    { en: 'Actual usage = opening + purchases − waste − staff meals & hospitality − closing.', ar: 'الاستهلاك الفعلي = أول المدة + المشتريات − الهالك − وجبات العاملين والضيافة − آخر المدة.' },
  ),

  // ---- The inflation simulator ----
  inSimulated: tip(
    { en: 'Simulated portion cost', ar: 'تكلفة الحصة المتوقعة' },
    { en: 'What a portion would cost at the prices tried; prep items carry the change through, as nested as they are. Nothing is saved.', ar: 'تكلفة الحصة بالأسعار المفترضة؛ والمصنّعات تنقل التغير مهما تداخلت. لا يُحفظ شيء.' },
    { en: 'Each price by the most specific rule: its own new price, else its category\'s %, else the global %. A made prep item: its average × (batch at the new prices ÷ batch now).', ar: 'كل سعر بأدق قاعدة: سعره الجديد، وإلا نسبة قسمه، وإلا النسبة العامة. والمصنّع المنتج: متوسطه × (التشغيلة بالأسعار الجديدة ÷ التشغيلة الحالية).' },
  ),
  inKeepFc: tip(
    { en: 'Price to keep food cost %', ar: 'سعر للحفاظ على نسبة التكلفة' },
    { en: 'The price that keeps the dish\'s food cost % where it is now.', ar: 'السعر الذي يبقي نسبة تكلفة الطبق كما هي الآن.' },
    { en: 'Price × simulated cost ÷ current cost.', ar: 'السعر × التكلفة المتوقعة ÷ التكلفة الحالية.' },
  ),
  inKeepMargin: tip(
    { en: 'Price to keep cash margin', ar: 'سعر للحفاظ على هامش الربح' },
    { en: 'The price that keeps the same pounds of gross profit on each plate.', ar: 'السعر الذي يبقي نفس الجنيهات من مجمل الربح في كل طبق.' },
    { en: 'Price + (simulated cost − current cost).', ar: 'السعر + (التكلفة المتوقعة − التكلفة الحالية).' },
  ),
  inImpact: tip(
    { en: 'Monthly profit impact', ar: 'أثر الربح الشهري' },
    { en: 'What the new prices would take from a month\'s profit if the menu prices stay as they are.', ar: 'ما ستأخذه الأسعار الجديدة من ربح الشهر إذا بقيت أسعار المنيو كما هي.' },
    { en: '(Current cost − simulated cost) × plates sold in the last 30 days.', ar: '(التكلفة الحالية − التكلفة المتوقعة) × الأطباق المباعة في آخر 30 يومًا.' },
  ),

  // ---- The daily break-even ----
  dbeFixed: tip(
    { en: 'Daily fixed costs', ar: 'نصيب اليوم من المصاريف الثابتة' },
    {
      en: "The day's share of the month's fixed costs: its payroll and wages, rent, utilities and running costs, interest and depreciation, and the expense vouchers and invoices under them. A month with nothing recorded yet takes the stand-in figures from Cost settings.",
      ar: 'نصيب اليوم من المصاريف الثابتة للشهر: الرواتب والأجور، والإيجار، والمرافق ومصاريف التشغيل، والفوائد والإهلاك، وسندات وفواتير المصروفات عليها. الشهر الذي لم يُسجل له شيء بعد يأخذ الأرقام التقديرية من الإعدادات.',
    },
    { en: "The month's fixed costs ÷ the days in the month.", ar: 'المصاريف الثابتة للشهر ÷ عدد أيام الشهر.' },
  ),
  dbeWacm: tip(
    { en: 'Contribution margin % (WACM)', ar: 'هامش المساهمة المرجح' },
    {
      en: "Of each pound sold today, what is left after the food cost of the dishes sold, towards the rent and the salaries; weighted by today's mix. With nothing sold yet, the seven days before's.",
      ar: 'نسبة ما يتبقى من مبيعات اليوم بعد خصم تكلفة الخامات، والذي يساهم في تغطية الإيجار والرواتب.',
    },
    {
      en: '(Sales − food cost of the dishes sold) ÷ sales × 100.',
      ar: '(المبيعات - تكلفة خامات الأطباق المباعة) ÷ المبيعات.',
    },
  ),
  dbeSales: tip(
    { en: 'Net sales', ar: 'صافي المبيعات' },
    {
      en: "The day's sales summary at the menu's prices, less each bill's discount, before VAT; delivery fees are not counted.",
      ar: 'ملخص مبيعات اليوم بأسعار المنيو، بعد خصم كل فاتورة وقبل الضريبة؛ ولا تدخل رسوم التوصيل.',
    },
    { en: 'Σ line total × (1 − the bill\'s discount ÷ its subtotal).', ar: 'مجموع قيمة السطر × (1 − خصم الفاتورة ÷ إجماليها).' },
  ),
  dbeFood: tip(
    { en: 'Variable food cost', ar: 'تكلفة الخامات المتغيرة' },
    {
      en: "What the recipes of the dishes sold today cost at today's costs: each material's moving average, prep items by their batches.",
      ar: 'تكلفة وصفات الأطباق المباعة اليوم بأسعار اليوم: متوسط تكلفة كل خامة، والمصنّعات بتكلفة تشغيلاتها.',
    },
    { en: 'Σ quantity sold × its recipe cost a portion (add-ons too); % = ÷ net sales × 100.', ar: 'مجموع الكمية × تكلفة الحصة من وصفتها (والإضافات)؛ النسبة = ÷ صافي المبيعات × 100.' },
  ),
  dbeTarget: tip(
    { en: 'Daily break-even sales', ar: 'نقطة التعادل اليومية' },
    {
      en: "What the day must sell to cover its share of the fixed costs, at the margin its own mix leaves: sell more dishes with a high margin and the target falls.",
      ar: 'ما يجب أن يبيعه اليوم ليغطي نصيبه من المصاريف الثابتة، بهامش مساهمة أطباقه: كلما زادت أطباق الهامش العالي انخفض الهدف.',
    },
    { en: 'Daily fixed costs ÷ WACM; still to sell = it − net sales.', ar: 'نصيب اليوم من المصاريف الثابتة ÷ هامش المساهمة؛ المتبقي = الهدف − صافي المبيعات.' },
  ),
  dbeResult: tip(
    { en: 'Operating result', ar: 'الربح أو الخسارة التشغيلية' },
    { en: "What the day leaves after its food and its share of the fixed costs: a profit once past the break-even.", ar: 'ما يتبقى لليوم بعد خاماته ونصيبه من المصاريف الثابتة: ربح بعد تجاوز نقطة التعادل.' },
    { en: 'Contribution margin (sales − food cost) − daily fixed costs.', ar: 'هامش المساهمة (المبيعات − تكلفة الخامات) − نصيب اليوم من المصاريف الثابتة.' },
  ),

  // ---- The fully burdened plate cost ----
  bcLaborPool: tip(
    { en: 'Labor pool allocated', ar: 'إجمالي العمالة المحملة' },
    {
      en: "The period's labor, shared over the plates sold: the payroll approved on HR (or the salaries paid for the month), the wages entered on the KPIs and wages paid as expenses. Each month is spread evenly over its days.",
      ar: 'عمالة الفترة موزعة على الأطباق المباعة: مسير الرواتب المعتمد (أو الرواتب المصروفة للشهر)، والأجور المدخلة في المؤشرات، والأجور المسجلة كمصروفات. كل شهر يُوزع بالتساوي على أيامه.',
    },
    {
      en: 'Σ each month × the days chosen in it ÷ its days. A month with nothing recorded takes the stand-in figure from Cost settings. Average a plate = allocated ÷ plates sold.',
      ar: 'مجموع كل شهر × أيام الفترة فيه ÷ عدد أيامه. الشهر الذي لا شيء مسجل له يأخذ الرقم التقديري من الإعدادات. المتوسط للطبق = المحمّل ÷ الأطباق المباعة.',
    },
  ),
  bcOverheadPool: tip(
    { en: 'Overhead pool allocated', ar: 'إجمالي الإيجار والمرافق والإهلاك' },
    {
      en: "Rent, utilities, running costs, interest and depreciation for the period: what is entered for each month on the KPIs, and the expense invoices and vouchers filed under an Occupation, Controllable or Other fixed category.",
      ar: 'الإيجار والمرافق ومصاريف التشغيل والفوائد والإهلاك للفترة: ما أُدخل لكل شهر في المؤشرات، وفواتير وسندات المصروفات تحت أقسام الإيجار والمصاريف القابلة للتحكم والثابتة.',
    },
    {
      en: 'Σ each month × the days chosen in it ÷ its days; a rent voucher on the 1st is carried by every plate of its month. Average a plate = allocated ÷ plates sold.',
      ar: 'مجموع كل شهر × أيام الفترة فيه ÷ عدد أيامه؛ سند الإيجار أول الشهر يتحمله كل طبق في الشهر. المتوسط للطبق = المحمّل ÷ الأطباق المباعة.',
    },
  ),
  bcAverageBurdened: tip(
    { en: 'Average fully burdened cost %', ar: 'متوسط التكلفة الكلية %' },
    {
      en: 'Of every pound the plates sold for, how much went on food, labor and overheads together; the rest is the true net margin.',
      ar: 'من كل جنيه بيعت به الأطباق، كم ذهب للخامات والعمالة والمصاريف معًا؛ والباقي هو صافي الربح الحقيقي.',
    },
    {
      en: 'Σ (fully burdened cost × plates sold) ÷ Σ (selling price × plates sold) × 100; net margin % = 100 − it.',
      ar: 'مجموع (التكلفة الكلية × الكمية) ÷ مجموع (سعر البيع × الكمية) × 100؛ ونسبة صافي الربح = 100 − هذه النسبة.',
    },
  ),
  bcBleeding: tip(
    { en: 'Dishes bleeding after overhead', ar: 'أطباق خاسرة بعد تحميل المصاريف' },
    {
      en: 'Dishes that look profitable on food cost alone but lose money once their labor and overheads are added: reprice them, cut their time or their cost, or rethink them.',
      ar: 'أطباق تبدو رابحة على تكلفة الخامات وحدها لكنها تخسر بعد إضافة العمالة والمصاريف: ارفع سعرها أو قلل وقتها أو تكلفتها أو أعد النظر فيها.',
    },
    { en: 'Selling price − food cost > 0, and selling price − fully burdened cost < 0.', ar: 'سعر البيع − تكلفة الخامات > 0، وسعر البيع − التكلفة الكلية < 0.' },
  ),
  bcActivity: tip(
    { en: 'Activity-based (prep time)', ar: 'حسب وقت التحضير (ABC)' },
    {
      en: "Labor goes where the kitchen's time goes: a dish that takes 20 minutes carries twice the labor of one that takes 10. Overheads (rent, utilities) are shared equally by the plate.",
      ar: 'العمالة تُحمّل حسب وقت المطبخ: طبق يستغرق 20 دقيقة يتحمل ضعف عمالة طبق يستغرق 10. والمصاريف (الإيجار والمرافق) تُوزع بالتساوي على الأطباق.',
    },
    {
      en: "Labor a plate = labor pool × its weighted minutes ÷ Σ (plates sold × weighted minutes). Weighted minutes = prep time × complexity, plus its prep items' share of their batches' time. Overhead a plate = overhead pool ÷ plates sold.",
      ar: 'عمالة الطبق = وعاء العمالة × دقائقه الموزونة ÷ مجموع (الكمية × الدقائق الموزونة). الدقائق الموزونة = وقت التحضير × معامل الصعوبة + نصيبه من وقت تشغيلات المصنّعات. مصاريف الطبق = وعاء المصاريف ÷ الأطباق المباعة.',
    },
  ),
  bcEqual: tip(
    { en: 'Equal per plate', ar: 'بالتساوي للطبق' },
    { en: 'Every plate sold carries the same labor and the same overheads, whatever it is.', ar: 'كل طبق مباع يتحمل نفس العمالة ونفس المصاريف أيًا كان.' },
    { en: 'Labor a plate = labor pool ÷ plates sold; overhead a plate = overhead pool ÷ plates sold.', ar: 'عمالة الطبق = وعاء العمالة ÷ الأطباق المباعة؛ مصاريف الطبق = وعاء المصاريف ÷ الأطباق المباعة.' },
  ),
  bcRevenue: tip(
    { en: 'By revenue %', ar: 'بنسبة الإيراد' },
    {
      en: 'Each dish carries labor and overheads in proportion to what it brings in: a dish twice the price carries twice the share.',
      ar: 'كل طبق يتحمل العمالة والمصاريف بنسبة مساهمته في الإيراد: طبق بضعف السعر يتحمل ضعف النصيب.',
    },
    {
      en: "Share = price × plates sold ÷ the period's sales; labor a plate = labor pool × share ÷ plates sold = labor pool × price ÷ sales (the same for the overheads).",
      ar: 'النسبة = السعر × الكمية ÷ مبيعات الفترة؛ عمالة الطبق = وعاء العمالة × النسبة ÷ الكمية = وعاء العمالة × السعر ÷ المبيعات (ومثلها المصاريف).',
    },
  ),
  bcSource: tip(
    { en: 'Actual or simulated pools', ar: 'المصاريف الفعلية أو التقديرية' },
    {
      en: "Actual: the period's own labor and overheads as recorded. Simulated: monthly figures you type, to test the plates' economics before a month's payroll and bills are in.",
      ar: 'الفعلية: عمالة ومصاريف الفترة كما سُجلت. التقديرية: أرقام شهرية تكتبها لاختبار ربحية الأطباق قبل اكتمال الرواتب والفواتير.',
    },
    {
      en: 'Simulated pool = the monthly figure × the days chosen in each month ÷ its days. Blank: the stand-in figures from Cost settings.',
      ar: 'الوعاء التقديري = الرقم الشهري × أيام الفترة في كل شهر ÷ عدد أيامه. فارغ: الأرقام التقديرية من الإعدادات.',
    },
  ),
  bcFood: tip(
    { en: 'Food cost', ar: 'تكلفة الخامات' },
    {
      en: "One plate's ingredients at today's costs, as its recipe card shows them: the moving averages, prep items by their batches, and the shared costs.",
      ar: 'خامات الطبق الواحد بتكلفة اليوم كما في كارت الوصفة: متوسط التكلفة المتحرك، والمصنّعات بتكلفة تشغيلاتها، والتكاليف المشتركة.',
    },
    { en: 'Recipe cost ÷ portions + shared costs a meal; food cost % = it ÷ selling price × 100.', ar: 'تكلفة الوصفة ÷ عدد الحصص + نصيب الوجبة من التكاليف المشتركة؛ النسبة = ÷ سعر البيع × 100.' },
  ),
  bcLabor: tip(
    { en: 'Allocated labor', ar: 'العمالة المحملة' },
    { en: "The plate's share of the period's labor, by the method chosen.", ar: 'نصيب الطبق من عمالة الفترة حسب الطريقة المختارة.' },
    {
      en: 'Activity-based: labor pool × weighted minutes ÷ Σ (plates × weighted minutes); equal: pool ÷ plates; by revenue: pool × price ÷ sales.',
      ar: 'حسب الوقت: الوعاء × الدقائق الموزونة ÷ مجموع (الكمية × الدقائق)؛ بالتساوي: الوعاء ÷ الأطباق؛ بالإيراد: الوعاء × السعر ÷ المبيعات.',
    },
  ),
  bcOverhead: tip(
    { en: 'Allocated overheads', ar: 'الإيجار والمرافق والإهلاك المحملة' },
    { en: "The plate's share of the period's rent, utilities, running costs, interest and depreciation.", ar: 'نصيب الطبق من إيجار ومرافق ومصاريف تشغيل وفوائد وإهلاك الفترة.' },
    { en: 'Equal and activity-based: overhead pool ÷ plates sold; by revenue: pool × price ÷ sales.', ar: 'بالتساوي وحسب الوقت: وعاء المصاريف ÷ الأطباق المباعة؛ بالإيراد: الوعاء × السعر ÷ المبيعات.' },
  ),
  bcBurdened: tip(
    { en: 'Fully burdened cost', ar: 'التكلفة الكلية للطبق' },
    { en: 'What one plate really costs the restaurant: its food, its labor and its share of the overheads.', ar: 'ما يكلفه الطبق الواحد فعلًا: خاماته وعمالته ونصيبه من المصاريف.' },
    {
      en: 'Food + labor + overheads; prime cost = food + labor; % = ÷ selling price × 100.',
      ar: 'الخامات + العمالة + المصاريف؛ التكلفة الأولية = الخامات + العمالة؛ النسبة = ÷ سعر البيع × 100.',
    },
  ),
  bcNetProfit: tip(
    { en: 'True net profit', ar: 'صافي الربح الحقيقي للطبق' },
    { en: 'What a plate leaves after everything it costs, and over the period, for the plates sold.', ar: 'ما يتبقى من الطبق بعد كل تكاليفه، وعلى الفترة للأطباق المباعة.' },
    {
      en: 'Selling price (before VAT) − fully burdened cost; margin % = it ÷ selling price × 100; period = it × plates sold.',
      ar: 'سعر البيع (قبل الضريبة) − التكلفة الكلية؛ النسبة = ÷ سعر البيع × 100؛ الفترة = × الكمية المباعة.',
    },
  ),
  bcSuggested: tip(
    { en: 'Suggested price', ar: 'السعر المقترح' },
    { en: 'The price that leaves the target net margin after food, labor and overheads.', ar: 'السعر الذي يحقق صافي الربح المستهدف بعد الخامات والعمالة والمصاريف.' },
    {
      en: 'Equal or activity-based: fully burdened cost ÷ (1 − target %). By revenue (the shares grow with the price): food ÷ (1 − target % − pools ÷ sales); none when the pools take what the margin leaves.',
      ar: 'بالتساوي أو حسب الوقت: التكلفة الكلية ÷ (1 − النسبة المستهدفة). بالإيراد: الخامات ÷ (1 − النسبة − الأوعية ÷ المبيعات)؛ لا سعر إذا استهلكت الأوعية ما يتبقى.',
    },
  ),
  bcPrepTime: tip(
    { en: 'Prep time (mins)', ar: 'وقت التحضير بالدقائق' },
    {
      en: "The kitchen's minutes of work for one plate (for a prep item, one batch), and how hard they are: 1 is an ordinary minute, 1.5 skilled work. Labor is shared by them on the activity-based method.",
      ar: 'دقائق عمل المطبخ للطبق الواحد (وللمصنّع: التشغيلة الواحدة)، ومعامل الصعوبة: 1 دقيقة عادية و1.5 عمل ماهر. تُوزع العمالة بها في طريقة حسب الوقت.',
    },
    {
      en: 'Weighted minutes = prep time × complexity + Σ (what a plate takes of each prep item ÷ its batch × the batch\'s weighted minutes). Blank: the ordinary 10 minutes.',
      ar: 'الدقائق الموزونة = وقت التحضير × معامل الصعوبة + مجموع (ما يأخذه الطبق من كل مصنّع ÷ تشغيلته × دقائق التشغيلة). فارغ: 10 دقائق.',
    },
  ),

  // ---- The stock card ----
  scOpening: tip(
    { en: 'Opening balance', ar: 'رصيد أول المدة' },
    { en: 'What was in stock when the first day began.', ar: 'الرصيد في بداية أول يوم من الفترة.' },
    { en: 'Σ every movement before the first day.', ar: 'مجموع كل الحركات قبل أول يوم.' },
  ),
  scIn: tip(
    { en: 'Total in', ar: 'إجمالي الوارد' },
    { en: 'Everything that came into stock in the period: purchases, batches made, counts found over, returns.', ar: 'كل ما دخل المخزن في الفترة: مشتريات، تصنيع، زيادة جرد، مرتجعات.' },
    { en: 'Σ positive movements in the period (a voided purchase counts out).', ar: 'مجموع الحركات الموجبة في الفترة (إلغاء فاتورة يُحسب منصرفًا).' },
  ),
  scOut: tip(
    { en: 'Total out', ar: 'إجمالي المنصرف' },
    { en: 'Everything that left stock in the period: sales, production, waste, counts found short.', ar: 'كل ما خرج من المخزن في الفترة: مبيعات، تصنيع، هالك، عجز جرد.' },
    { en: 'Σ negative movements in the period.', ar: 'مجموع الحركات السالبة في الفترة.' },
  ),
  scClosing: tip(
    { en: 'Closing on hand', ar: 'رصيد آخر المدة' },
    { en: 'What the book says is in stock at the end of the last day.', ar: 'الرصيد الدفتري في نهاية آخر يوم.' },
    { en: 'Opening + total in − total out; value = closing × the moving average then.', ar: 'أول المدة + الوارد − المنصرف؛ القيمة = الرصيد × المتوسط المتحرك وقتها.' },
  ),
  scAverage: tip(
    { en: 'Moving average cost (AP$)', ar: 'متوسط التكلفة المتحرك' },
    { en: 'What a purchase unit in stock costs now: every valuation and recipe uses it.', ar: 'تكلفة وحدة الشراء في المخزون الآن: تستخدمه كل التقييمات والوصفات.' },
    {
      en: 'At each priced delivery or batch: (on hand × average + quantity × price) ÷ (on hand + quantity); a voided one is taken back out.',
      ar: 'عند كل توريد أو تصنيع مُسعّر: (الرصيد × المتوسط + الكمية × السعر) ÷ (الرصيد + الكمية)؛ ويُستبعد المُلغى.',
    },
  ),
  scBalance: tip(
    { en: 'Running balance', ar: 'الرصيد بعد الحركة' },
    { en: 'What was in stock right after this movement, whatever the filter shows.', ar: 'الرصيد مباشرة بعد هذه الحركة، بغض النظر عن الفلتر.' },
    { en: 'Previous balance + in − out, over the whole ledger.', ar: 'الرصيد السابق + الوارد − المنصرف، على كامل الدفتر.' },
  ),
  scUnitPrice: tip(
    { en: 'Unit price', ar: 'سعر الحركة' },
    { en: 'The price the movement was made at: the price paid on a purchase, the batch cost of a batch, the average cost then for the rest.', ar: 'سعر الحركة: سعر الشراء للمشتريات، تكلفة الدفعة للتصنيع، والمتوسط وقتها لباقي الحركات.' },
    { en: 'Per purchase unit; value = quantity × unit price.', ar: 'لكل وحدة شراء؛ القيمة = الكمية × سعر الحركة.' },
  ),
  scAverageAfter: tip(
    { en: 'Moving avg after', ar: 'المتوسط بعد الحركة' },
    { en: 'The moving average cost the movement left.', ar: 'متوسط التكلفة المتحرك بعد هذه الحركة.' },
    {
      en: 'Changed only by a priced purchase or batch (weighted with the stock on the shelf) or its void; other movements carry it on.',
      ar: 'لا يتغير إلا بشراء أو تصنيع مُسعّر (مرجحًا بالرصيد) أو إلغائه؛ باقي الحركات تحمله كما هو.',
    },
  ),

  // ---- Where an item is used, and the bulk swap ----
  wuQuantity: tip(
    { en: 'Used per portion', ar: 'الكمية في الحصة' },
    {
      en: 'How much of the item one portion of the dish takes (a prep item: one batch). On the recipe: as written. Inside its prep items: what they take of it.',
      ar: 'كم تأخذ الحصة الواحدة من الطبق من هذا الصنف (المصنّع: الدفعة الواحدة). في الوصفة مباشرة: كما هو مكتوب. داخل المصنّعات: ما تأخذه منه.',
    },
    {
      en: 'On the recipe: quantity ÷ portions. Inside a prep item: what the portion takes of it × the item in a gram of it (its batch, as purchased, through every prep item inside).',
      ar: 'في الوصفة: الكمية ÷ عدد الحصص. داخل المصنّع: ما تأخذه الحصة منه × نصيب الجرام منه من الصنف (حسب دفعته، بالوزن قبل التنظيف، عبر كل المصنّعات الداخلة).',
    },
  ),
  wuItemCost: tip(
    { en: 'Its cost in a portion', ar: 'تكلفته في الحصة' },
    { en: 'What this item alone costs in one portion (a prep item: one batch), at today\'s average cost.', ar: 'تكلفة هذا الصنف وحده في الحصة الواحدة (المصنّع: الدفعة)، بمتوسط التكلفة اليوم.' },
    { en: 'Everything a portion takes of it, as purchased (on it and inside its prep items) × its cost a unit.', ar: 'كل ما تأخذه الحصة منه بالوزن قبل التنظيف (مباشرة وداخل المصنّعات) × تكلفة الوحدة.' },
  ),
  bsRatio: tip(
    { en: 'Conversion ratio', ar: 'معامل التحويل' },
    {
      en: 'How much of the new item replaces each unit of the old one. 1 is gram for gram; lower it when the new item goes further (a stronger cheese, a better yield).',
      ar: 'كم من الخامة الجديدة يحل محل كل وحدة من القديمة. 1 يعني جرام بجرام؛ قلّله إن كانت الجديدة أقوى أو أعلى عائدًا.',
    },
    {
      en: 'New quantity = old quantity × ratio, as edible portion in each item\'s own unit (100 g at 0.8 is 80 g). The new line takes the new item\'s own default yield.',
      ar: 'الكمية الجديدة = الكمية القديمة × المعامل، كوزن صافٍ بوحدة كل صنف (100 جم × 0.8 = 80 جم). ويأخذ السطر الجديد نسبة العائد الافتراضية للخامة الجديدة.',
    },
  ),
  bsDelta: tip(
    { en: 'Cost delta', ar: 'فرق التكلفة' },
    {
      en: 'What the swap does to a portion\'s cost (a prep item: a batch\'s). Positive: dearer. A prep item made already moves with its next batches.',
      ar: 'أثر الاستبدال على تكلفة الحصة (المصنّع: الدفعة). الموجب يعني أغلى. والمصنّع المُنتج من قبل تتغير تكلفته مع الدفعات القادمة.',
    },
    {
      en: 'New cost − old cost. New: the recipe with the new item, its prep items as the swap leaves them; a prep item made already at its average × (its batch with the new item ÷ its batch now).',
      ar: 'التكلفة الجديدة − القديمة. الجديدة: الوصفة بالخامة الجديدة ومصنّعاتها بعد الاستبدال؛ والمصنّع المُنتج بمتوسطه × (دفعته بالجديدة ÷ دفعته الآن).',
    },
  ),
  bsKnockOn: tip(
    { en: 'Dishes moved through prep items', ar: 'أطباق تتأثر عبر المصنّعات' },
    { en: 'Dishes without the old item on them whose cost still moves, because a prep item they use is swapped.', ar: 'أطباق لا تحتوي الخامة القديمة مباشرة، لكن تكلفتها تتغير لأن مصنّعًا تستخدمه سيتم استبداله.' },
    { en: 'The dish\'s cost with the swapped prep items − its cost now.', ar: 'تكلفة الطبق بالمصنّعات بعد الاستبدال − تكلفته الآن.' },
  ),
  rfContains: tip(
    { en: 'Contains', ar: 'يحتوي على' },
    { en: 'Only the recipes with this item: on the recipe, or inside one of its prep items.', ar: 'الوصفات التي بها هذا الصنف فقط: في الوصفة نفسها أو داخل أحد مصنّعاتها.' },
    { en: 'From the item\'s where-used list, through every prep item.', ar: 'من قائمة أين يُستخدم الصنف، عبر كل المصنّعات.' },
  ),
  rfNetMargin: tip(
    { en: 'True net margin', ar: 'هامش الربح الصافي' },
    {
      en: 'What is left of the price after food, labor and overheads: the fully burdened plate cost of this month so far.',
      ar: 'ما يتبقى من السعر بعد الخامات والعمالة والمصاريف: التكلفة الكلية للطبق لهذا الشهر حتى الآن.',
    },
    { en: '(Price − fully burdened cost) ÷ price × 100, as Cost settings share the labor and overheads.', ar: '(السعر − التكلفة الكلية) ÷ السعر × 100، بطريقة التحميل في إعدادات التكاليف.' },
  ),

  // ---- Combo offers ----
  coTotalCost: tip(
    { en: 'Total combo cost', ar: 'إجمالي تكلفة العرض' },
    { en: 'What the dishes in the combo cost together today, from their own recipes: nothing is entered twice.', ar: 'تكلفة أصناف العرض معًا اليوم، من وصفاتها نفسها: لا تُكرر أي خامة.' },
    { en: 'Σ each dish\'s cost a portion × how many of it the combo holds.', ar: 'مجموع (تكلفة حصة كل صنف × عدده في العرض).' },
  ),
  coOriginal: tip(
    { en: 'Original separate price', ar: 'السعر الأصلي منفصلًا' },
    { en: 'What the same dishes would sell for one by one, at their own prices: the customer\'s saving is the difference.', ar: 'سعر نفس الأصناف لو بيعت منفصلة بأسعارها: والتوفير للعميل هو الفرق.' },
    { en: 'Σ each dish\'s price (the menu\'s, or a planned price off it) × its quantity.', ar: 'مجموع (سعر كل صنف × عدده).' },
  ),
  coFoodCost: tip(
    { en: 'Combo food cost %', ar: 'نسبة تكلفة العرض' },
    {
      en: 'The share of the combo\'s price its food takes. A combo sells cheaper than its dishes apart, so this is above theirs: keep it under the target.',
      ar: 'نسبة الخامات من سعر العرض. العرض أرخص من أصنافه منفصلة، فتكون نسبته أعلى: أبقها تحت المستهدف.',
    },
    { en: 'Total combo cost ÷ the combo\'s selling price × 100.', ar: 'إجمالي تكلفة العرض ÷ سعر بيع العرض × 100.' },
  ),

  // ---- Promos and discounts against the margin ----
  deDiscounts: tip(
    { en: 'Total discounts', ar: 'إجمالي الخصومات' },
    { en: 'What was taken off the menu prices in the month before the money was collected: never in the till or the safe.', ar: 'ما خُصم من أسعار المنيو في الشهر قبل التحصيل: لا يدخل الدرج ولا الخزنة.' },
    { en: 'Σ each day\'s discounts on its takings; the share is of the standard gross revenue (net sales + discounts).', ar: 'مجموع خصومات كل يوم في توريده؛ والنسبة من الإيراد القياسي (صافي المبيعات + الخصومات).' },
  ),
  deStandard: tip(
    { en: 'Standard food cost %', ar: 'نسبة التكلفة القياسية' },
    { en: 'The food cost % had every dish sold at its full menu price.', ar: 'نسبة التكلفة لو بيع كل صنف بسعر المنيو كاملًا.' },
    { en: 'Theoretical cost ÷ (net sales + discounts) × 100.', ar: 'التكلفة النظرية ÷ (صافي المبيعات + الخصومات) × 100.' },
  ),
  deActual: tip(
    { en: 'Actual food cost %', ar: 'نسبة التكلفة الفعلية' },
    {
      en: 'The real food cost percentage after accounting for money lost to discounts.',
      ar: 'نسبة التكلفة الحقيقية بعد احتساب المال الضائع في الخصومات.',
    },
    { en: 'Theoretical cost ÷ net revenue after discounts (cash + card, before tax) × 100.', ar: 'التكلفة النظرية ÷ صافي الإيراد بعد الخصومات (كاش + فيزا قبل الضريبة) × 100.' },
  ),
  deErosion: tip(
    { en: 'Margin erosion', ar: 'تآكل الهامش' },
    { en: 'How many points of food cost the discounts added: the kitchen cost the same, the money that came in was less.', ar: 'كم نقطة أضافتها الخصومات لنسبة التكلفة: تكلفة المطبخ نفسها، والمال المحصل أقل.' },
    { en: 'Actual food cost % − standard food cost %.', ar: 'نسبة التكلفة الفعلية − نسبة التكلفة القياسية.' },
  ),
  deReasons: tip(
    { en: 'Top discount reasons', ar: 'أهم أسباب الخصومات' },
    { en: 'Why the discounts were given, the largest first, with how many bills.', ar: 'أسباب الخصومات، الأكبر أولًا، مع عدد الفواتير.' },
    { en: 'Each reason\'s amounts and counts over the month\'s takings; a voided day\'s taken back out.', ar: 'مجموع مبالغ وعدد كل سبب في توريدات الشهر؛ ويُطرح اليوم الملغى.' },
  ),

  // ---- Fixed assets and the profit and loss ----
  faTotalCost: tip(
    { en: 'Total assets cost', ar: 'إجمالي تكلفة الأصول' },
    {
      en: 'What the assets still held at the end of the month cost to buy and put in place. Capital spending: it left the safe or the bank, never the P&L.',
      ar: 'ما تكلفه شراء وتركيب الأصول القائمة في نهاية الشهر. إنفاق رأسمالي: خرج من الخزنة أو البنك، ولا يظهر في قائمة الدخل.',
    },
    { en: 'Σ purchase cost of every asset bought by the month’s end and not disposed of or sold by then.', ar: 'مجموع تكلفة شراء كل أصل اشتري حتى نهاية الشهر ولم يُستبعد أو يُبع.' },
  ),
  faAccumulated: tip(
    { en: 'Accumulated depreciation', ar: 'مجمع الإهلاك' },
    {
      en: 'How much of the assets’ cost the P&L has taken so far, a month at a time.',
      ar: 'ما حمّلته قائمة الدخل من تكلفة الأصول حتى الآن، شهرًا بشهر.',
    },
    {
      en: 'Σ monthly depreciation × months charged (from the month bought, never the month disposed of), at most the cost less the salvage value.',
      ar: 'مجموع (قسط الإهلاك الشهري × عدد الأشهر المحملة من شهر الشراء)، بحد أقصى التكلفة ناقص القيمة التخريدية.',
    },
  ),
  faNetBookValue: tip(
    { en: 'Net book value', ar: 'القيمة الدفترية الحالية' },
    { en: 'What is left of the assets’ cost on the books: what is still to be depreciated, and the salvage value.', ar: 'ما تبقى من تكلفة الأصول في الدفاتر: الجزء الذي لم يُهلك بعد والقيمة التخريدية.' },
    { en: 'Total assets cost − accumulated depreciation.', ar: 'إجمالي تكلفة الأصول − مجمع الإهلاك.' },
  ),
  faRunRate: tip(
    { en: 'Monthly depreciation run rate', ar: 'قسط الإهلاك الشهري الحالي' },
    {
      en: 'What this month’s P&L is charged for the assets: the Depreciation expense line, below EBITDA.',
      ar: 'ما تُحمّله قائمة دخل هذا الشهر للأصول: بند إهلاك الأصول الثابتة بعد الربح التشغيلي (EBITDA).',
    },
    {
      en: 'Σ (purchase cost − salvage value) ÷ useful life in months, over each asset still within its life; its last month takes what the rounding left.',
      ar: 'مجموع (تكلفة الشراء − القيمة التخريدية) ÷ العمر الإنتاجي بالأشهر لكل أصل داخل عمره؛ والشهر الأخير يأخذ فرق التقريب.',
    },
  ),
  faGainLoss: tip(
    { en: 'Capital gain / (loss)', ar: 'ربح / (خسارة) رأسمالية' },
    { en: 'What disposing of or selling the asset made or lost against what was left of its cost: on the P&L of the month it went.', ar: 'ما حققه أو خسره بيع الأصل أو استبعاده مقارنة بالمتبقي من تكلفته: في قائمة دخل شهر الاستبعاد.' },
    { en: 'Sale proceeds − net book value when it went (nothing, for a write-off).', ar: 'قيمة البيع − القيمة الدفترية وقت الاستبعاد (صفر في حالة الاستبعاد بلا مقابل).' },
  ),
  plEbitda: tip(
    { en: 'EBITDA', ar: 'الربح التشغيلي قبل الفوائد والضرائب والإهلاك' },
    { en: 'What running the restaurant made before interest, taxes, depreciation and amortization: the operating result, not hidden by what the equipment cost.', ar: 'ما حققه تشغيل المطعم قبل الفوائد والضرائب والإهلاك: نتيجة التشغيل دون أن تخفيها تكلفة المعدات.' },
    { en: 'Gross profit − operating expenses (wages, running costs, occupation, other fixed costs, hospitality).', ar: 'مجمل الربح − المصروفات التشغيلية (الأجور، المصاريف الجارية، الإيجار، المصاريف الثابتة الأخرى، الضيافة).' },
  ),
  plDepreciation: tip(
    { en: 'Depreciation expense', ar: 'إهلاك الأصول الثابتة' },
    { en: 'The month’s share of what the fixed assets cost. Buying them (CAPEX) never comes here: only this, a month at a time.', ar: 'نصيب الشهر من تكلفة الأصول الثابتة. شراؤها (CAPEX) لا يظهر هنا: فقط هذا القسط شهرًا بشهر.' },
    { en: 'The fixed assets register’s straight-line depreciation for the month + any depreciation entered for the month.', ar: 'إهلاك القسط الثابت للشهر من سجل الأصول + أي إهلاك مُدخل يدويًا للشهر.' },
  ),
  plNetProfit: tip(
    { en: 'Net profit', ar: 'صافي الربح النهائي' },
    { en: 'What is left after everything: the running costs, the interest, the assets’ depreciation and what disposing of them made or lost.', ar: 'ما يتبقى بعد كل شيء: مصاريف التشغيل والفوائد وإهلاك الأصول وأرباح أو خسائر استبعادها.' },
    { en: 'EBITDA − interest − depreciation expense ± gain / (loss) on asset disposals.', ar: 'EBITDA − الفوائد − إهلاك الأصول ± أرباح / (خسائر) استبعاد الأصول.' },
  ),

  // ---- Purchase orders and the 3-way match ----
  poExpectedPrice: tip(
    { en: 'Expected price', ar: 'السعر المتوقع' },
    { en: 'What one purchase unit should cost on this order, net of discounts: the delivery’s invoice is checked against it.', ar: 'سعر وحدة الشراء المتفق عليه في أمر الشراء صافيًا من الخصومات: تُطابق عليه فاتورة التوريد.' },
    { en: 'The latest net price paid for the item (or the cheapest supplier’s, from the order planner); its average when nothing was bought yet.', ar: 'آخر سعر شراء صافٍ للصنف (أو أرخص مورد من مخطط الطلبيات)، أو متوسط تكلفته إن لم يُشترَ بعد.' },
  ),
  poReceived: tip(
    { en: 'Received', ar: 'نسبة الاستلام' },
    { en: 'How much of the order has come, on the invoices posted against it.', ar: 'ما وصل من أمر الشراء على الفواتير المرحلة عليه.' },
    { en: '(Expected total − what is left to come × its expected price) ÷ expected total × 100.', ar: '(الإجمالي المتوقع − المتبقي × سعره المتوقع) ÷ الإجمالي المتوقع × 100.' },
  ),
  poRemaining: tip(
    { en: 'Left to come', ar: 'المتبقي' },
    { en: 'What is still to be delivered: the backorder, at the prices ordered.', ar: 'ما لم يُورد بعد (الطلبية المتأخرة) بأسعار أمر الشراء.' },
    { en: 'Σ (ordered − received) × expected unit price, over each line.', ar: 'مجموع (المطلوب − المستلم) × السعر المتوقع لكل بند.' },
  ),
  poMatch: tip(
    { en: '3-way match', ar: 'المطابقة الثلاثية' },
    {
      en: 'Each item checked three ways: the purchase order (what was ordered, at what price), what came through the door (the quantity received) and the supplier’s invoice (what it is billed).',
      ar: 'كل صنف يُراجع من ثلاث جهات: أمر الشراء (الكمية والسعر)، والاستلام الفعلي (الكمية المستلمة)، وفاتورة المورد (المبلغ المطالب به).',
    },
    {
      en: 'Matched; Price overcharge: net unit price above the expected by more than 0.5%; Qty over: more than was left to come; Partial / short: less. Over the price or the quantity, anyone but a manager waits for a manager’s sign-off.',
      ar: 'مطابق؛ زيادة سعر: صافي سعر الوحدة أعلى من المتوقع بأكثر من 0.5%؛ كمية زائدة: أكثر من المتبقي؛ استلام جزئي: أقل. زيادة السعر أو الكمية تنتظر موافقة المدير لغير المدير.',
    },
  ),
  poNetUnitPrice: tip(
    { en: 'Actual net unit price', ar: 'صافي سعر الوحدة الفعلي' },
    { en: 'What one purchase unit really cost on this invoice, after its discounts: what goes into the average cost.', ar: 'تكلفة وحدة الشراء الفعلية في هذه الفاتورة بعد الخصومات: ما يدخل متوسط التكلفة.' },
    { en: '(Line total − line discount − its share of the invoice discount) ÷ quantity received.', ar: '(إجمالي البند − خصم البند − نصيبه من خصم الفاتورة) ÷ الكمية المستلمة.' },
  ),
  poOvercharge: tip(
    { en: 'Overcharge', ar: 'قيمة الزيادة' },
    { en: 'What the invoice bills above the order’s prices, on the lines over the tolerance.', ar: 'ما تطالب به الفاتورة فوق أسعار أمر الشراء في البنود التي تتجاوز الحد المسموح.' },
    { en: 'Σ (net unit price − expected unit price) × quantity received, over each line priced above the order by more than 0.5%.', ar: 'مجموع (صافي سعر الوحدة − السعر المتوقع) × الكمية المستلمة للبنود التي تزيد بأكثر من 0.5%.' },
  ),
  poBackorder: tip(
    { en: 'Backorder or close', ar: 'إبقاء المتبقي أو الإغلاق' },
    { en: 'A short delivery: keep what did not come open on the order for the next delivery, or close the order with what came.', ar: 'عند الاستلام الجزئي: إبقاء المتبقي مفتوحًا على أمر الشراء للتوريد القادم، أو إغلاق الأمر بالكمية المستلمة.' },
    { en: 'Kept open: Remaining = ordered − received, status Partially received. Closed: status Completed, nothing more expected.', ar: 'مفتوح: المتبقي = المطلوب − المستلم، والحالة استلام جزئي. مغلق: الحالة مكتمل ولا يُنتظر المزيد.' },
  ),
  bulkSalesImport: tip(
    { en: 'Multi-day upload', ar: 'استيراد عدة أيام' },
    {
      en: "You can now upload multiple days at once. Make sure to add the 'Date' column in the template and ensure no days are skipped!",
      ar: 'يمكنك رفع عدة أيام معاً، تأكد من تعبئة عمود التاريخ وعدم تخطي أي أيام.',
    },
    {
      en: 'The rows are grouped by their Date and imported oldest first. The file starts on the day after the last closed day whose sales are not in yet, its days follow one another (a closed day is marked on End of the day first), and none is still to come. Previewed first; then every day is recorded, with its end of day as a draft, or none is.',
      ar: 'تُجمع الصفوف حسب التاريخ وتُستورد من الأقدم. يبدأ الملف من أول يوم بعد آخر يوم مُقفل لم تُسجل مبيعاته، والأيام متتالية (يوم الإغلاق يُسجل أولاً من تقفيل اليوم)، ولا يوم في المستقبل. تُعرض معاينة أولاً، ثم تُسجل كل الأيام مع مسودة تقفيل لكل يوم، أو لا يُسجل شيء.',
    },
  ),
  stockLocation: tip(
    { en: 'Stock location', ar: 'موقع المخزون' },
    {
      en: 'Where in the branch the stock is put or taken: the main store, the kitchen, the bar. Each location keeps its own quantity; the branch keeps one average cost for all of them.',
      ar: 'مكان المخزون داخل الفرع: المخزن الرئيسي أو المطبخ أو البار. لكل موقع رصيده، وللفرع متوسط تكلفة واحد لكل مواقعه.',
    },
    {
      en: 'A location’s stock is the sum of its entries. Left as the main store, a delivery is put away there; what the kitchen uses comes from the location serving the material’s station.',
      ar: 'رصيد الموقع هو مجموع حركاته. الاستلام في المخزن الرئيسي ما لم يُختر غيره، وما يستهلكه المطبخ يُصرف من الموقع المرتبط بقسم الخامة.',
    },
  ),
  internalTransfer: tip(
    { en: 'Internal transfer', ar: 'التحويل الداخلي' },
    {
      en: 'Stock moved from one location of the branch to another, the main store to the kitchen or the bar. Nothing is bought, used or lost: only where it is changes.',
      ar: 'نقل المخزون من موقع لآخر داخل الفرع، من المخزن الرئيسي للمطبخ أو البار. لا شراء ولا استهلاك ولا هالك: يتغير المكان فقط.',
    },
    {
      en: 'Out of one location and into the other at the branch’s average cost: no cost of the period. Only what the location it leaves has can be moved. Voided, both sides go back.',
      ar: 'يُصرف من موقع ويُضاف لآخر بمتوسط تكلفة الفرع، بلا أثر على التكلفة. لا يُحوَّل أكثر من رصيد موقع الصرف، والإلغاء يعيد الطرفين.',
    },
  ),
  locationStock: tip(
    { en: 'Stock by location', ar: 'الرصيد حسب الموقع' },
    {
      en: 'What each location of the branch holds of each material, with the branch’s total and its value.',
      ar: 'رصيد كل خامة في كل موقع من مواقع الفرع، مع إجمالي الفرع وقيمته.',
    },
    {
      en: 'Each figure is the sum of the location’s entries: deliveries, transfers in and out, use, waste and counts. Value: the total at the branch’s average cost.',
      ar: 'كل رقم هو مجموع حركات الموقع: الاستلام والتحويل والاستهلاك والهالك والجرد. القيمة: الإجمالي بمتوسط تكلفة الفرع.',
    },
  ),
  interBranchHub: tip(
    { en: 'Inter-branch hub', ar: 'المطبخ المركزي وتحويلات الفروع' },
    {
      en: 'A restaurant asks the central kitchen for goods (a requisition); the kitchen sends and bills them (Dispatch & Bill); the branch receives them. Each step in the branch chosen at the top of the screen.',
      ar: 'يطلب الفرع البضاعة من المطبخ المركزي، فيصرفها المركزي بفاتورة بيع داخلية، ويستلمها الفرع بفاتورة مشتريات داخلية. كل خطوة في الفرع المختار أعلى الشاشة.',
    },
    {
      en: 'The kitchen\u2019s stock leaves when it is dispatched; the branch\u2019s comes in when it is received. In between it is on its way, in neither.',
      ar: 'يخرج المخزون من المركزي عند الصرف ويدخل الفرع عند الاستلام، وبينهما يكون في الطريق.',
    },
  ),
  requisition: tip(
    { en: 'Requisition', ar: 'أمر طلب بضاعة' },
    {
      en: 'What a branch asks its central kitchen or warehouse to send, and by when. Quantities only: the kitchen prices what it sends.',
      ar: 'ما يطلبه الفرع من المطبخ أو المخزن المركزي وموعده. كميات فقط، والمركزي يسعّر ما يصرفه.',
    },
    {
      en: 'Cancelled only before anything of it is dispatched. Printed as a slip, or copied for WhatsApp, never with a price.',
      ar: 'يُلغى قبل أي صرف فقط. يُطبع أو يُنسخ لواتساب بدون أسعار.',
    },
  ),
  internalSalesInvoice: tip(
    { en: 'Dispatch & Bill', ar: 'إذن صرف وفاتورة بيع داخلية' },
    {
      en: 'The kitchen sends the goods out of one of its locations, at its average cost, and bills the branch on an internal sales invoice (ISI).',
      ar: 'يصرف المركزي البضاعة من أحد مواقعه بمتوسط تكلفته، ويفوترها للفرع بفاتورة بيع داخلية.',
    },
    {
      en: 'Only what the location holds is sent. The revenue and cost of goods are inter-company: the company\u2019s own P&L takes them out again.',
      ar: 'لا يُصرف أكثر من رصيد الموقع. الإيراد والتكلفة بين فروع الشركة وتُستبعد من أرباح الشركة المجمعة.',
    },
  ),
  internalPurchaseInvoice: tip(
    { en: 'Branch receipt', ar: 'استلام الفرع وفاتورة مشتريات داخلية' },
    {
      en: 'The branch counts what came and takes it into one of its locations, at the price billed, on an internal purchase invoice (IPI). Its average cost moves by that price.',
      ar: 'يعدّ الفرع ما وصل ويستلمه في أحد مواقعه بسعر الفاتورة، بفاتورة مشتريات داخلية، ويتحرك متوسط تكلفته بهذا السعر.',
    },
    {
      en: 'Billed for everything sent; what did not arrive is kept as a transit loss, with what happened.',
      ar: 'يُفوتر بكل المرسل، وما لم يصل يُسجل عجز نقل مع سببه.',
    },
  ),
  transferPricing: tip(
    { en: 'Transfer pricing', ar: 'سياسة تسعير التحويل الداخلي' },
    {
      en: 'At cost: the kitchen bills its own weighted average cost. Transfer price: its cost plus a markup, or a price typed for a line.',
      ar: 'بالتكلفة: بمتوسط تكلفة المركزي. بسعر تحويل: التكلفة مضافاً إليها هامش، أو سعر يُكتب للبند.',
    },
    {
      en: 'The branch receives at the price billed, so its recipes carry what it paid the kitchen. Prices are set by whoever sees costs.',
      ar: 'يستلم الفرع بسعر الفاتورة فتعكس وصفاته ما دفعه للمركزي. الأسعار يحددها من يرى التكاليف.',
    },
  ),
  openRequisitions: tip(
    { en: 'Open requisitions', ar: 'طلبات فروع قيد الانتظار' },
    { en: 'Requisitions asked by this branch or of it, with something still to send.', ar: 'طلبات هذا الفرع أو الموجهة إليه التي لم تُصرف بالكامل.' },
    { en: 'Submitted or partly dispatched, whenever they were made.', ar: 'المرسلة أو المصروفة جزئياً أياً كان تاريخها.' },
  ),
  shipmentsInTransit: tip(
    { en: 'Shipments in transit', ar: 'شحنات في الطريق' },
    { en: 'Dispatched, by this branch or to it, and not received yet.', ar: 'شحنات مصروفة من هذا الفرع أو إليه ولم تُستلم بعد.' },
    { en: 'Out of the kitchen\u2019s stock and not yet in the branch\u2019s: receive them on Branch receipts.', ar: 'خرجت من المركزي ولم تدخل الفرع بعد؛ تُستلم من تبويب الاستلامات.' },
  ),
  receiptsThisMonth: tip(
    { en: 'Receipts this month', ar: 'شحنات مستلمة هذا الشهر' },
    { en: 'Shipments received this month, by this branch or from it.', ar: 'الشحنات المستلمة هذا الشهر من هذا الفرع أو إليه.' },
    { en: 'Voided receipts are not counted.', ar: 'لا تُحسب الاستلامات الملغاة.' },
  ),
  interBranchBilling: tip(
    { en: 'Inter-branch billing', ar: 'إجمالي فوترة المطبخ المركزي' },
    {
      en: 'What the kitchen billed this month on its internal sales invoices, to this branch or by it.',
      ar: 'إجمالي فواتير البيع الداخلية لهذا الشهر من هذا الفرع أو إليه.',
    },
    {
      en: 'Inter-company: it moves money between branches, not in or out of the company. Voided invoices are not counted.',
      ar: 'بين فروع الشركة: لا تدخل أو تخرج من الشركة. لا تُحسب الفواتير الملغاة.',
    },
  ),
  locationStations: tip(
    { en: 'Stations served', ar: 'الأقسام المخدومة' },
    {
      en: 'The kitchen or bar stations that take their stock from this location: what their dishes use when sold comes off its shelves.',
      ar: 'أقسام المطبخ أو البار التي تسحب من هذا الموقع: ما تستهلكه أصنافها عند البيع يُخصم من رصيده.',
    },
    {
      en: 'A station is served by one location of a branch. A material whose station no location serves is taken from the main store.',
      ar: 'يخدم القسمَ موقعٌ واحد في الفرع. والخامة التي لا يخدم قسمَها أي موقع تُصرف من المخزن الرئيسي.',
    },
  ),
  structureOpenSpace: tip(
    { en: 'Single branch, open space', ar: 'فرع واحد بمساحة مفتوحة' },
    {
      en: 'All physical goods are in one place. No internal transfers needed.',
      ar: 'كل البضاعة في مكان واحد ولا حاجة لأذونات صرف داخلية.',
    },
    {
      en: 'One branch and one implicit store (Main Store). No location lists, no transfer screens, no branch selector: one stock figure and one average cost per material, as the system has always worked.',
      ar: 'فرع واحد ومخزن واحد ضمني. لا قوائم مواقع ولا شاشات تحويل ولا اختيار فرع: رصيد واحد ومتوسط تكلفة واحد لكل خامة كما يعمل النظام دائماً.',
    },
  ),
  structureSubStores: tip(
    { en: 'Single branch with sub-stores', ar: 'فرع واحد يحتوي على مخزن ومناطق تشغيل' },
    {
      en: 'A single branch containing a locked main warehouse and kitchen operating locations.',
      ar: 'فرع واحد يحتوي على مخزن رئيسي مغلق وعُهد تشغيل لأقسام المطبخ.',
    },
    {
      en: 'One branch with several inventory locations (Main Store, Kitchen, Bar), added under Locations below. Stock kept per location and internal transfers between them follow in the next release.',
      ar: 'فرع واحد بعدة مواقع مخزون (المخزن الرئيسي، المطبخ، البار) تُضاف من قسم المواقع. رصيد كل موقع والتحويلات الداخلية بينها في الإصدار القادم.',
    },
  ),
  structureIndependent: tip(
    { en: 'Several independent branches', ar: 'فروع متعددة تشتري وتعمل بشكل مستقل' },
    {
      en: 'Multiple branches, each managing its own purchases and stock independently.',
      ar: 'فروع متعددة، كل فرع يشتري الخامات ويحسب تكلفته بشكل مستقل.',
    },
    {
      en: 'Branches are added below; a branch selector at the top of the screen lets whoever works every branch choose one, and each user can be kept to theirs. Purchases, sales, the safe, Z reports, waste and counts are recorded under the branch they are entered in, and the lists show that branch’s.',
      ar: 'تُضاف الفروع من الأسفل، ويظهر اختيار الفرع أعلى الشاشة لمن يعمل في كل الفروع، ويمكن تخصيص فرع لكل مستخدم. تُسجل المشتريات والمبيعات والخزنة وتقارير Z والهالك والجرد باسم الفرع، وتعرض القوائم حركات الفرع.',
    },
  ),
  structureCentralKitchen: tip(
    { en: 'Branches with a central kitchen', ar: 'فروع متعددة يدعمها مطبخ مركزي / مخزن رئيسي' },
    {
      en: 'A Central Kitchen/Warehouse purchases and preps items, then supplies/sells them to the restaurant branches.',
      ar: 'مطبخ مركزي يشتري ويُصنع الخامات ثم يوردها ويبيعها لباقي الفروع.',
    },
    {
      en: 'Everything several branches have, with a branch of type Central kitchen or Central warehouse. Branch requisitions, Dispatch & Bill and Receive with internal invoices follow in a later release.',
      ar: 'كل ما في الفروع المتعددة، مع فرع من نوع مطبخ مركزي أو مخزن رئيسي. طلبات الفروع والصرف بفاتورة داخلية والاستلام في إصدار لاحق.',
    },
  ),
  kitchenStation: tip(
    { en: 'Kitchen station', ar: 'القسم التشغيلي' },
    {
      en: 'The kitchen or bar section that keeps this material or prep item, or makes this dish: its use and its waste are held against that station on Station variance. None: the shared station.',
      ar: 'قسم المطبخ أو البار المسؤول عن الخامة أو المصنّع أو الطبق: يُحاسب القسم على استهلاكها وهالكها في انحراف الأقسام. بدون قسم: الخامات المشتركة.',
    },
    {
      en: 'Set on Raw materials, Prep items (one or every one shown) and the recipe card, or by the Station column of the raw materials sheet. Stations are a manager’s to set on Cost settings.',
      ar: 'يُحدد من الخامات والمصنعات (صنف أو كل المعروض) وكارت الوصفة أو عمود القسم في شيت الخامات، والأقسام يضبطها المدير من إعدادات التكاليف.',
    },
  ),
  responsibleStation: tip(
    { en: 'Station responsible', ar: 'القسم المسؤول' },
    {
      en: 'The station held to account for this waste: the material’s own unless another is chosen (the hot kitchen that spoiled a shared item).',
      ar: 'القسم الذي يُحاسب على هذا الهالك: قسم الخامة إلا إذا اخترت غيره (كأن يُتلف المطبخ الساخن خامة مشتركة).',
    },
    {
      en: 'Its worth, at the cost then, goes to that station’s logged waste on Station variance. A dish voided after the kitchen made it is the waste of the station that makes the dish.',
      ar: 'قيمته بتكلفة وقتها تُضاف لهالك ذلك القسم في انحراف الأقسام، والطبق الملغى بعد التحضير هالك القسم الذي يحضّره.',
    },
  ),
  stationTolerance: tip(
    { en: 'Station tolerance', ar: 'نسبة السماح للقسم' },
    {
      en: 'How far its materials’ actual use may stray above what the sales should have taken before the station is High loss. Blank: the costing settings’ tolerance.',
      ar: 'أقصى زيادة مسموحة لاستهلاك خامات القسم عن النظري قبل أن يُعد عجزًا مرتفعًا. فارغ: نسبة إعدادات التكاليف.',
    },
    {
      en: 'Within target up to three quarters of it, Watch above that, High loss past it.',
      ar: 'منضبط حتى ثلاثة أرباعها، تحت المراقبة بعد ذلك، وعجز مرتفع إذا تجاوزها.',
    },
  ),
  stationTheoretical: tip(
    { en: 'Theoretical cost', ar: 'التكلفة النظرية' },
    {
      en: 'What the dishes sold should have used of the station’s materials, by their recipes and through the prep items, with what is held in prep stock made from them.',
      ar: 'ما كان يجب أن تستهلكه الأطباق المباعة من خامات القسم بوصفاتها ومن خلال المصنعات، مع ما بقي في مخزون المصنعات منها.',
    },
    { en: 'Σ theoretical usage × average cost now, over the station’s materials.', ar: 'مجموع (الاستهلاك النظري × متوسط التكلفة الحالي) لخامات القسم.' },
  ),
  stationActual: tip(
    { en: 'Actual cost', ar: 'التكلفة الفعلية' },
    { en: 'What the stores say the station’s materials were used for over the period.', ar: 'ما تقوله المخازن عن استهلاك خامات القسم في الفترة.' },
    {
      en: '(Opening + purchases − logged waste − staff meals & hospitality − closing) × average cost now, over its materials.',
      ar: '(أول المدة + المشتريات − الهالك المسجل − وجبات العاملين والضيافة − آخر المدة) × متوسط التكلفة الحالي.',
    },
  ),
  stationUnexplained: tip(
    { en: 'Unexplained variance', ar: 'الانحراف غير المبرر' },
    {
      en: 'Used beyond what the sales, the logged waste and the staff meals account for: over-portioning, waste not logged, a recipe written too light, or stock walking out.',
      ar: 'ما استُهلك زيادة عما تبرره المبيعات والهالك المسجل ووجبات العاملين: زيادة الحصص، هالك غير مسجل، وصفة أخف من الواقع، أو تسرب.',
    },
    { en: 'Actual cost − theoretical cost, over the station’s materials.', ar: 'التكلفة الفعلية − التكلفة النظرية لخامات القسم.' },
  ),
  stationPercent: tip(
    { en: 'Variance %', ar: 'نسبة الانحراف' },
    { en: 'The unexplained as a share of what should have been used.', ar: 'الانحراف غير المبرر كنسبة مما كان يجب استهلاكه.' },
    { en: 'Unexplained ÷ theoretical × 100. None when nothing should have been used.', ar: 'الانحراف ÷ النظري × 100، ولا نسبة إذا كان النظري صفرًا.' },
  ),
  stationWaste: tip(
    { en: 'Logged waste', ar: 'الهالك المسجل' },
    {
      en: 'Spoilage logged and dishes voided after the kitchen made them, held against the station responsible for each (not always the material’s own).',
      ar: 'الهالك المسجل والأطباق الملغاة بعد التحضير، محسوبة على القسم المسؤول عن كل منها (وليس دائمًا قسم الخامة).',
    },
    { en: 'Σ quantity wasted × the cost then, less refunds put back.', ar: 'مجموع الكمية المهدرة × تكلفتها وقتها، ناقص المرتجعات.' },
  ),
  stationComparison: tip(
    { en: 'Stations compared', ar: 'مقارنة الأقسام' },
    {
      en: 'Each station’s unexplained variance % against its own tolerance line: the bar past its line is the section bleeding food cost. Click a bar or a card for its materials.',
      ar: 'نسبة الانحراف لكل قسم أمام خط السماح الخاص به: الشريط الذي يتجاوز خطه هو القسم الذي يستنزف التكلفة. اضغط على شريط أو بطاقة لعرض خاماته.',
    },
    { en: 'Bar: unexplained ÷ theoretical × 100. Line: the station’s tolerance, or the settings’.', ar: 'الشريط: الانحراف ÷ النظري × 100، والخط: نسبة السماح للقسم أو للإعدادات.' },
  ),
} satisfies Record<string, InfoTipContent>;

export type InfoTipKey = keyof typeof infoTips;
