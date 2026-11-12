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
} satisfies Record<string, InfoTipContent>;

export type InfoTipKey = keyof typeof infoTips;
