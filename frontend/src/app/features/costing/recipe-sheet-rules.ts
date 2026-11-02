// What the recipes' and the prep items' sheets have in common, as their import dialogs say it.
export const recipeSheetRules: { en: string; ar: string }[] = [
  {
    en: 'Each ingredient’s name says its unit, "Flour (Kg)": write the quantity in it, 0.2 for 200 g.',
    ar: 'اسم كل مكوّن يذكر وحدته، "دقيق (Kg)": اكتب الكمية بها، 0.2 لـ 200 جرام.',
  },
  {
    en: 'An item’s rows replace its whole list of ingredients. One with a row that cannot be read is left as it was.',
    ar: 'صفوف الصنف تحل محل كل مكوناته. والصنف الذي به صف خاطئ يبقى كما هو.',
  },
  {
    en: 'No prices on the sheet: what each costs is worked out from its ingredients’ prices now.',
    ar: 'لا أسعار في الملف: التكلفة تُحسب من أسعار المكونات الحالية.',
  },
];
