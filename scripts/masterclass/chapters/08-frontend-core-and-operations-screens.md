# الفصل 08: نواة الفرونت إند وشاشات التشغيل

[← الفصل السابق](07-excel-engines-and-ecosystem-links.md) · [الفهرس](00-index-and-build-roadmap.md) · [الفصل التالي: شاشات الماليات والتقارير والنشر →](09-frontend-financials-reports-and-deployment.md)

> هذا أكبر فصل لأن شاشات التشغيل هي معظم الواجهة. اقرأ الأقسام 1-4 أولًا (المعمارية والأدوات)، ثم الشاشات بالترتيب الذي يناسبك.

## 1. Angular الحديث في هذا المشروع

| المفهوم | هنا |
| --- | --- |
| المكوّنات | **Standalone**: كل مكوّن يعلن `imports: [...]`، بلا `NgModule` |
| الحالة | **Signals**: `signal()`, `computed()`, `effect()`؛ والتطبيق **Zoneless** (لا `zone.js`) |
| المدخلات | `input()`, `input.required()`, `model()`، وبارامترات الرابط تصل كـ `input()` (`withComponentInputBinding`) |
| القوالب | `@if`, `@for (…; track …)`, `@switch`, `@let` |
| HTTP | `HttpClient` + دوال `HttpInterceptorFn` |
| التوجيه | دوال `CanActivateFn` و **Lazy Loading** لكل صفحة |
| النماذج | **Template-Driven** (`[(ngModel)]`) مع أداة تحقق `FormChecks` تشير للحقل المخطئ (لا Reactive Forms في المشروع) |
| الاختبارات | Vitest + jsdom |

### 1.1 دورة حياة الشاشة (نمط تكرره كل الصفحات)

```text
الإنشاء   constructor/effect() ⇐ يقرأ المدخلات (?date=, :id) ويبدأ التحميل
التحميل   loading.set(true) → await firstValueFrom(api.x()) → data.set(...) → loading.set(false)
الاشتقاق  computed(): القائمة بعد البحث والفلتر والترتيب، المجاميع، الصلاحيات
العرض     @if (loading()) … @for (x of shown(); track x.id)
الفعل     زر ⇒ async action() ⇒ نافذة MatDialog أو API ⇒ notify + إعادة تحميل
الخطأ     catch ⇒ errorMessage(error) يعرض رسالة الخادم كما هي (عربي/إنجليزي)
المعرّفات  crypto.randomUUID() عند فتح النموذج مرة واحدة ⇒ إعادة الإرسال لا تكرر (Idempotency)
```

## 2. ملفات المشروع

`package.json` (Angular ~21.2، Material، Vitest، و `build` عبر `scripts/build.mjs`):

@@file frontend/package.json

`angular.json` (esbuild، الميزانيات، الـ proxy، Vitest)، و `tsconfig*` (`strict` و `strictTemplates`)، و `vitest.config.ts`:

@@file frontend/angular.json

@@file frontend/tsconfig.json

@@file frontend/tsconfig.app.json

@@file frontend/tsconfig.spec.json

@@file frontend/vitest.config.ts

`proxy.conf.json`: `ng serve` يحوّل `/api` إلى الـ API على 5100، فالكود يستدعي `/api/...` نسبيًا دائمًا.

@@file frontend/proxy.conf.json

`scripts/build.mjs`: `ng build` في هذه النسخة لا يخرج بعد البناء (عملية esbuild تبقى حية) فيعلق بناء Docker؛ السكربت يمرر المخرجات وينهي العملية عند `Output location:` أو عند الفشل.

@@file frontend/scripts/build.mjs

## 3. نقطة البداية والتوجيه

@@file frontend/src/index.html

@@file frontend/src/main.ts

@@file frontend/src/app/app.ts

### 3.1 `app.config.ts`: سطرًا سطرًا

- `provideBrowserGlobalErrorListeners()`: الأخطاء غير المعالجة لمعالج Angular.
- `provideRouter(routes, withComponentInputBinding())`: التوجيه، وبارامترات الرابط كمدخلات للمكوّن.
- `provideHttpClient(withInterceptors([reachabilityInterceptor, authInterceptor]))`: مراقبة الوصول للخادم، ثم إضافة التوكن، بالترتيب.
- `provideAppInitializer(() => inject(AuthService).restore())`: قبل أول صفحة، يتأكد من التوكن المخزن عبر `/api/auth/me`.
- `provideAppInitializer(() => loadCompany())`: اسم الشركة وشعارها وعملتها لكل شاشة.
- `provideAppInitializer(() => inject(WesternDigits).install())`: الأرقام العربية في حقول الأرقام تُكتب غربية تلقائيًا.
- `MAT_FORM_FIELD_DEFAULT_OPTIONS: { appearance: 'outline' }`.

@@file frontend/src/app/app.config.ts

### 3.2 `app.routes.ts`

كل قسم بـ `canActivate: [costingTabGuard('Materials')]` و `loadComponent` كسول، والأقسام الفرعية (الوصفات، المشتريات، الماليات، التقارير، التحليلات) كأبناء لـ Shell خاص بها، والمسار الفارغ يفتح أول قسم يملكه المستخدم.

@@file frontend/src/app/app.routes.ts

## 4. النواة (core)

### 4.1 HTTP

`authInterceptor`: يضيف `Authorization: Bearer` لطلبات `/api/` بنسخة من الطلب (`request.clone`)؛ و 401 على غير الدخول ⇐ خروج مع رسالة "انتهت الجلسة". `reachabilityInterceptor`: رمز 0 ⇐ الخادم غير متاح (شريط تنبيه).

@@file frontend/src/app/core/http/interceptors.ts

@@file frontend/src/app/core/http/error-message.ts

@@file frontend/src/app/core/connectivity/connectivity.service.ts

### 4.2 الشركة والأدوات

@@file frontend/src/app/core/settings/company.ts

`FormChecks`: زر الحفظ **لا يُعطَّل أبدًا**؛ عند النقص يُعلَّم كل حقل ناقص بالأحمر وتحته ما ينقصه ويُركّز على أوله.

@@file frontend/src/app/core/ui/form-checks.ts

@@file frontend/src/app/core/ui/money.pipe.ts

@@file frontend/src/app/core/ui/notify.service.ts

@@file frontend/src/app/core/ui/paper-preview.ts

@@file frontend/src/app/core/ui/save-blob.ts

@@file frontend/src/app/core/ui/western-digits.ts

### 4.3 عقود الـ API

`costing.api.ts`: أكبر ملف: كل الأنواع والنداءات لـ `api/costing` و `api/inventory` و `api/financials` (الخامات، التكاليف، الوصفات، المصنعات، الإنتاج، المشتريات، الجرد، الهالك، الخزنة، التقارير، الموافقات…). الأنواع تطابق DTOs الـ API، والـ enums كـ union types، وقواميس التسميات ثنائية اللغة (`Record<Kind, { en; ar }>`) تجبر TypeScript على تسمية كل حالة.

@@file frontend/src/app/core/costing/costing.api.ts

@@file frontend/src/app/core/costing/end-of-day.api.ts

@@file frontend/src/app/core/costing/menu-sales.api.ts

@@file frontend/src/app/core/costing/staff.ts

`EmployeePicker`: اختيار موظف بالاسم أو الوظيفة أو القسم أو **كود HR**.

@@file frontend/src/app/core/costing/employee-picker.ts

## 5. الأدوات المشتركة: البحث الذكي والترتيب والتنقل بـ Enter

### 5.1 البحث الذكي العربي (`smart-search.ts`): سطرًا سطرًا

`searchable(text)` يحوّل النص لشكل "قابل للمقارنة":

1. `normalize('NFKD')` ثم حذف علامات التشكيل اللاتينية (é ⇐ e).
2. الأرقام العربية/الفارسية ⇐ غربية: `(charCode & 0xf) % 10` (حيلة: آخر 4 بتات من كود ٠-٩ و ۰-۹ هي الرقم نفسه).
3. حذف التشكيل العربي والتطويل (ـ).
4. توحيد الألفات (أ إ آ ٱ ⇐ ا)، والتاء المربوطة ⇐ هاء، والألف المقصورة ⇐ ياء.
5. حروف صغيرة، ومسافات موحدة.

`smartMatch(needle, ...fields)`: **كل كلمة مكتوبة** موجودة في أحد الحقول، **بأي ترتيب**: "chick 12" تجد "Chicken breast" بكود ING-12، و "دقيق" تجد "Flour · دقيق". و `compareValues` / `sortItems`: ترتيب بلغة القارئ (العربية أيضًا)، والأرقام بالحجم، **والقيم الناقصة آخرًا دائمًا** (صنف بلا تكلفة بعد المسعّر سواء رتبت تصاعديًا أو تنازليًا).

@@file frontend/src/app/features/shared/smart-search.ts

@@file frontend/src/app/features/shared/search-field.ts

@@file frontend/src/app/features/shared/sort-control.ts

@@file frontend/src/app/features/shared/filter-select.ts

### 5.2 التنقل بـ Enter داخل الجداول (`GridKeys`)

إدخال فاتورة بلوحة المفاتيح وحدها: `Enter` في حقل ⇐ الحقل التالي في نفس الصف (الصنف ⇐ الكمية ⇐ السعر)؛ `Enter` في آخر حقل من آخر صف ⇐ يضيف صفًا (`appGridKeysAppend`) ويذهب لأول حقوله. والـ autocomplete الذي يأخذ `Enter` لاختيار خياره: ينتقل بعد أن يستقر الاختيار. وحقول التذييل (خصم الفاتورة) تحتفظ بـ `Enter` لنفسها.

@@file frontend/src/app/features/shared/grid-keys.ts

### 5.3 اختيار الأصناف والتخطيط

`ItemPicker`: autocomplete يعرض أول مطابقات ويطلب كتابة المزيد بعدها، و `PickRow` صف اختيار بشارة نوعه. `SideLayout`: الأقسام كشريط جانبي (Drawer على الموبايل) بمجموعات. `SubNav`: تبويبات فرعية كحبوب. و `pages.scss` الأنماط المشتركة (`.ar`, `.inline-ar`, `.toolbar.smart`, `.pills`…).

@@file frontend/src/app/features/shared/item-picker.ts

@@file frontend/src/app/features/shared/pick-row.ts

@@file frontend/src/app/features/shared/side-layout.ts

@@file frontend/src/app/features/shared/sub-nav.ts

@@file frontend/src/app/features/shared/pages.scss

### 5.4 الثيم والهيكل

`styles.scss`: Material 3 بألوان Slate & Indigo (لون واحد عميق لما يُختار ويُنفَّذ، ورماديات لكل ما هو ساكن)، وخط النظام بدل خط ويب (يعمل بلا إنترنت).

@@file frontend/src/styles.scss

`Shell`: الشريط العلوي بالأقسام وحالة الاتصال وشريط "الخادم غير متاح".

@@file frontend/src/app/features/shell/shell.ts

@@file frontend/src/app/features/shell/shell.html

@@file frontend/src/app/features/shell/shell.scss

`CostingShell`: الأقسام الجانبية **من الصلاحيات** (`computed`)، بمجموعاتها. و `costing.scss` أنماط شاشات التكاليف، و `FormChecks` نسخة شاشات التكاليف (تشير لـ "الفاتورة 2، البند 3: أدخل الكمية")، و `PeriodBar` شريط الفترة: فترات جاهزة كأزرار، أو من/إلى بتاريخين (من لا يتجاوز إلى).

**`InfoTip` (ⓘ):** البطاقات والأعمدة تعرض **الرقم فقط**، وشرحه في زر صغير بجانب العنوان: نافذة منبثقة (CDK `cdkConnectedOverlay`) فيها **الوصف** و **طريقة الحساب** بالعربية والإنجليزية. تفتح بالمرور وبالتركيز (لوحة المفاتيح)، وبالضغط على الهاتف فتبقى مثبتة حتى ضغطة ثانية، وتغلق بـ Escape أو بالضغط خارجها. النافذة `role="tooltip"` وهي `aria-describedby` للزر. والرمز مرسوم بـ CSS (`::before`) لا بخط أيقونات، حتى يبقى نص العنوان كلماته هو (ولقارئ الشاشة). والنصوص كلها في `info-tips.ts` بمفاتيح مكتوبة النوع (`InfoTipKey`)، فخطأ المفتاح خطأ ترجمة لا خطأ تشغيل؛ ويقبل المكوّن أيضًا نصًا يُبنى في مكانه (مؤشرات الـ KPI من تعريفها).

@@file frontend/src/app/features/costing/info-tip.ts

@@file frontend/src/app/features/costing/info-tips.ts

@@file frontend/src/app/features/costing/costing-shell.ts

@@file frontend/src/app/features/costing/costing.scss

@@file frontend/src/app/features/costing/form-checks.ts

@@file frontend/src/app/features/costing/period-bar.ts

---

## 6. شاشات الخامات

**`MaterialsPage`:** الخامات بتكاليفها: AP$ لكل وحدة شراء (المتوسط)، Yield الافتراضي، EP$، الرصيد وقيمته، وحد الطلب. بحث ذكي، فلتر الفئة والنوع، ترتيب، تصدير واستيراد. و `MaterialDialog`: الإنشاء والتعديل وتغيير وحدة العد (مع شرح ما سيُعاد صياغته). وفيه **حاسبة نسبة الصافي** (احسب من الوزن): نافذة منبثقة بوزنين، القائم والصافي بعد التنظيف، تحسب النسبة = الصافي ÷ القائم × 100 و EP$ = AP$ ÷ النسبة، و "استخدم النسبة" تضعها في الحقل؛ وتلميح الحقل يعرض EP$ الناتج دائمًا. و `MaterialHistoryDialog`: **سجل مشتريات الصنف** (كل بند فاتورة اشترى الخامة، الأحدث أولًا، والملغى مشطوب) لمطابقة الورق عند جرد مريب. و `StockCardDialog`: **كارتة الصنف** (الفصل 06): الفترة ونوع الحركة، شريط أول المدة والوارد والمنصرف وآخر المدة والمتوسط، ثم الدفتر سطرًا سطرًا، و Excel كما هو مفلتر. ومرجع كل سطر يفتح مصدره: الفاتورة فوق الكارتة وسطر الخامة فيها مُعلَّم مع طريق تصحيحها (تعديل الفاتورة يلغيها ويُعيد إدخالها)، والتشغيلة في نافذتها، والجرد في صفحته، ومبيعات اليوم في صفحة المبيعات على يومها والإيصال مُعلَّم (`?day=&receipt=`)، والتالف في سجل الهالك (`?spoilage=`)؛ وكل مرجع لا يُفتح إلا لمن يعمل تبويبه. و `StockCardButton` زر الكارتة بجانب اسم الخامة في جداول التحليلات. و `MaterialPicker` و `QuickMaterialDialog` لإضافة خامة سريعًا من سطر فاتورة.

@@file frontend/src/app/features/costing/materials-page.ts

@@file frontend/src/app/features/costing/material-dialog.ts

@@file frontend/src/app/features/costing/material-history-dialog.ts

@@file frontend/src/app/features/costing/stock-card-dialog.ts

@@file frontend/src/app/features/costing/material-picker.ts

@@file frontend/src/app/features/costing/quick-material-dialog.ts

## 7. شاشات الوصفات والمصنعات

`RecipesShell` ثم `RecipesPage`: الوصفات (الكل، على المنيو، خارجه)، **أصناف المنيو بلا وصفة**، والمحذوفة؛ و "أضف للمنيو" لوصفات خارج المنيو.

@@file frontend/src/app/features/costing/recipes-shell.ts

@@file frontend/src/app/features/costing/recipes-page.ts

### 7.1 بطاقة الوصفة (`RecipeCardPage`): الشاشة الأهم محاسبيًا

لكل سطر، كما في القالب الورقي: `EP$/وحدة = AP$/وحدة ÷ Yield`، وتكلفة السطر = كمية EP × EP$ (بوحدات الشراء). ثم تكلفة الحصة، سعر البيع، نسبة التكلفة، والحالة مقابل الهدف. المصنّع بلا دفعات يظهر "حسب وصفته". الربط بصنف/حجم/إضافة من المنيو، والأسطر بـ `GridKeys`.

@@file frontend/src/app/features/costing/recipe-card-page.ts

@@file frontend/src/app/features/costing/recipe-categories-page.ts

@@file frontend/src/app/features/costing/recipe-category-dialog.ts

`PrepItemsPage` و `PrepItemPage`: المصنعات بتكلفتها بوصفتها اليوم وتكلفة دفعاتها على الرف ورصيدها، وصفحة وصفة الدفعة (EP للدفعة، وكمية الدفعة).

@@file frontend/src/app/features/costing/prep-items-page.ts

@@file frontend/src/app/features/costing/prep-item-page.ts

## 8. الإنتاج

`ProductionPage`: اختر المصنّع، المخطط (يحدد المكونات بوصفته)، والمنتج فعلًا؛ راجع ما ستأخذه مقابل السجلات وتكلفتها بمتوسط اليوم؛ ثم سجّل (مدير) أو اطلب. و `ProductionOrderDialog`: دفعة كما صُنعت، للقراءة.

@@file frontend/src/app/features/costing/production-page.ts

@@file frontend/src/app/features/costing/production-order-dialog.ts

## 9. المنيو

`MenuPage`: الفئات والأصناف (الرقم يُعطى مرة)، الأحجام بأسعارها، الإضافات، والاستيراد. و `AddToMenuDialog`: الوصفات خارج المنيو، كلها معلّمة، بالسعر المخطط وفئة المطبخ، **ونسبة تكلفة لحظية** لكل صف، و "فئة للباقي"، والنتيجة بالأكواد.

@@file frontend/src/app/features/costing/menu-page.ts

@@file frontend/src/app/features/costing/add-to-menu-dialog.ts

## 10. المشتريات

`PurchasesShell`. ثم `InvoiceLines` (مشترك بين شاشة الفاتورة وكل فاتورة في اليومية): البنود، الوحدات، المجاميع، **حصص الخصم** (`discount` signal و `shares`)، المورد، والإضافة السريعة، و **حارس السعر** (`priceDeviation`): إن ابتعد سعر وحدة الشراء في السطر عن المتوسط الحالي بأكثر من ±25% ظهرت شارة كهرمانية "تنبيه: السعر يختلف بـ X% عن المتوسط الحالي - تأكد من الوحدة!"، تنبيه فقط لا يمنع الحفظ (أغلب أسبابه جرامات كُتبت كيلوهات). و `PurchasesPage`: الخطوتان (حفظ مسودة ⇐ تأكيد وترحيل)، وصورة الورقة.

@@file frontend/src/app/features/costing/purchases-shell.ts

@@file frontend/src/app/features/costing/invoice-lines.ts

@@file frontend/src/app/features/costing/purchases-page.ts

### 10.1 يومية المشتريات (`PurchaseBatchPage`)

فاتورة لكل مورد بمعرّف يُصنع هنا، نقدي/آجل لكل فاتورة، **الفواتير المسلّمة في تقفيل اليوم** تفتح جاهزة مع صورتها للنسخ ("مسلّمة"/"مطابقة")، والصور تُرسل بعد الترحيل، وما لم يُرسل يعرض "أعد المحاولة". والمسودة محفوظة محليًا (بلا الصور) حتى لا يضيع العمل.

@@file frontend/src/app/features/costing/purchase-batch-page.ts

`InvoicesPage` (القائمة)، `InvoicePage` (فاتورة بصفحة للقراءة؛ "تعديل" = تصحيح بفاتورة جديدة)، `InvoiceView` و `InvoiceViewDialog`، و `InvoicePaper` (صورة الورقة بالتوكن).

@@file frontend/src/app/features/costing/invoices-page.ts

@@file frontend/src/app/features/costing/invoice-page.ts

@@file frontend/src/app/features/costing/invoice-view.ts

@@file frontend/src/app/features/costing/invoice-view-dialog.ts

@@file frontend/src/app/features/costing/invoice-paper.ts

الفئات وحذفها (بخطة لكل صنف)، والموردون، والمصروفات العمومية:

@@file frontend/src/app/features/costing/purchase-categories-page.ts

@@file frontend/src/app/features/costing/purchase-category-dialog.ts

@@file frontend/src/app/features/costing/purchase-category-field.ts

@@file frontend/src/app/features/costing/category-delete-dialog.ts

@@file frontend/src/app/features/costing/suppliers-page.ts

@@file frontend/src/app/features/costing/supplier-dialog.ts

@@file frontend/src/app/features/costing/expense-items-page.ts

@@file frontend/src/app/features/costing/expense-item-dialog.ts

## 11. تقفيل اليوم (شرح مفصّل)

### 11.1 `EndOfDayPage`

- **اليوم:** من `?date=` أو اليوم التجاري من الخادم، ولا يتجاوز اليوم.
- **الأقسام الستة** (الفصل 05): لكل نوع فاتورة نموذج `EodInvoiceForm` (الصورة من الكاميرا أو ملف، المورد، الإجمالي، ملاحظة) بمعرّف يُصنع مرة؛ ونماذج المدفوعات `EodPayoutForm`؛ وتقرير المبيعات (العُهدة، الكاش، الفيزا، الضريبة، الإلغاءات، صورة Z).
- **بطاقة صافي الكاش في الدرج** تتحدث مع الكتابة: `العُهدة + الكاش + ضريبة الكاش − (نقدي + سداد + سلف)`، والفيزا خارجها.
- **المراجعة** (`EndOfDaySummaryDialog`): تقرير ملخص قبل التسليم؛ لا تسليم بفاتورة أو دفعة مكتوبة لم تُضف، أو بلا مبيعات.
- **بعد التسليم:** القسم مقفول، وما تحوّل لفواتير وقيود يظهر بحالته، وإعادة الفتح للمدير.

@@file frontend/src/app/features/costing/end-of-day-page.ts

### 11.2 نماذج المدفوعات والصور

`EodPayoutForm`: الإيصال (كاميرا بـ `capture="environment"` أو ملف)، المورد أو الموظف (من HR مع الربط "From HR"، وإضافة موظف جديد بدونه)، المبلغ، والملاحظة. و `end-of-day-photo.ts`: عرض الصور بالتوكن ونافذة الصورة. وتصغير الصور الكبيرة قبل الرفع (`shrinkPhoto`: أطول ضلع 2000 بكسل، جودة 0.85) في `end-of-day.api.ts`.

@@file frontend/src/app/features/costing/end-of-day-payouts.ts

@@file frontend/src/app/features/costing/end-of-day-photo.ts

## 12. المبيعات

`SalesPage`: ملخصات الأيام وأصنافها. و `DailySalesDialog`: إدخال ملخص اليوم بأكواد المنيو (`"6101-2 · Margherita (Large)"`) بأسعاره، و `DailySalesImportDialog` من شيت العمودين.

@@file frontend/src/app/features/costing/sales-page.ts

@@file frontend/src/app/features/costing/daily-sales-dialogs.ts

## 13. الجرد

`CountsPage`: المسودة الحالية (إن وجدت) والجرود المرحّلة، وزرّان للبدء: افتتاحي ودوري. و `CountSheetPage`: ورقة العد بالأقسام، **حفظ تلقائي** بعد آخر إدخال بمهلة قصيرة ("طويلة بما يكفي لكتابة رقم، قصيرة بما لا يضيع شيء إن وُضع التابلت")، وتغيير النوع، وقيمة المسودة بأسعار اليوم، والترحيل.

@@file frontend/src/app/features/costing/counts-page.ts

@@file frontend/src/app/features/costing/count-sheet-page.ts

## 14. الهالك والكسر

`WastePage`: الهالك (خامات تالفة بسبب: تخرج من المخزون) والكسر (مستهلكات: تكلفة على اليوم)، وإلغاؤهما بموافقة.

@@file frontend/src/app/features/costing/waste-page.ts

[الفصل التالي: شاشات الماليات والتقارير والنشر →](09-frontend-financials-reports-and-deployment.md)
