// The tabs of HR & Payroll, and Custody & Assets beside them, as the API names them (صلاحيات
// الموظفين): what a manager gives an employee, who works them in the portal, or an accountant, in
// the system. A manager has them all.
export type HrTab = 'Now' | 'Analytics' | 'Employees' | 'Departments' | 'Attendance' | 'Roster' | 'Corrections' | 'Payroll' | 'Advances' | 'Holidays' | 'Devices' | 'Custody';

export interface HrTabInfo {
  tab: HrTab;
  // Its address under /hr.
  path: string;
  en: string;
  ar: string;
  // Its Material icon, beside its name in the sections.
  icon: string;
  // What holding it lets them do, as the Permissions page says it.
  hint: { en: string; ar: string };
}

// HR & Payroll's own tabs, in the order they are shown.
export const hrTabs: readonly HrTabInfo[] = [
  { tab: 'Now', path: 'now', en: 'Now', ar: 'الآن', icon: 'how_to_reg', hint: { en: 'Who is in right now', ar: 'من موجود الآن' } },
  { tab: 'Analytics', path: 'analytics', en: 'Analytics', ar: 'التحليلات', icon: 'insights', hint: { en: 'Attendance, labour cost and turnover', ar: 'الحضور وتكلفة العمالة ودوران العمالة' } },
  { tab: 'Employees', path: 'employees', en: 'Employees', ar: 'الموظفين', icon: 'groups', hint: { en: 'Their records, pay and profiles', ar: 'بياناتهم ورواتبهم وملفاتهم' } },
  { tab: 'Departments', path: 'departments', en: 'Departments', ar: 'الأقسام', icon: 'account_tree', hint: { en: 'Departments, roles and their cost', ar: 'الأقسام والوظائف وتكلفتها' } },
  { tab: 'Attendance', path: 'attendance', en: 'Attendance', ar: 'الحضور والانصراف', icon: 'event_available', hint: { en: 'Each day’s punches, marks and penalties', ar: 'البصمات والإجازات والجزاءات يوميًا' } },
  // Its own tab, beside Attendance: holding Attendance alone gives none of it.
  { tab: 'Roster', path: 'roster', en: 'Shift Rostering', ar: 'جداول الشفتات', icon: 'calendar_view_week', hint: { en: 'Shifts, and who works which each day', ar: 'الشفتات ومن يعمل في كل منها' } },
  { tab: 'Corrections', path: 'corrections', en: 'Corrections', ar: 'مراجعة وجزاءات', icon: 'rule', hint: { en: 'Suspended days and late punches', ar: 'الأيام الموقوفة والبصمات المتأخرة' } },
  { tab: 'Payroll', path: 'payroll', en: 'Payroll', ar: 'مسير الرواتب', icon: 'payments', hint: { en: 'The monthly payroll and payslips', ar: 'مسير الرواتب الشهري والقسائم' } },
  { tab: 'Advances', path: 'advances', en: 'Advances', ar: 'السلفيات', icon: 'request_quote', hint: { en: 'Advances and their shares', ar: 'السلف وتوزيعها' } },
  // The leaves and the public holidays (the tab the API calls Holidays).
  { tab: 'Holidays', path: 'leaves', en: 'Leaves & Holidays', ar: 'الإجازات والعطلات', icon: 'beach_access', hint: { en: 'Leave requests, balances and holidays', ar: 'طلبات الإجازة والأرصدة والعطلات' } },
  { tab: 'Devices', path: 'devices', en: 'Attendance devices', ar: 'أجهزة البصمة', icon: 'fingerprint', hint: { en: 'The attendance devices and their users', ar: 'أجهزة البصمة ومستخدموها' } },
];

// Custody & Assets, a section of its own (/custody), given as a tab is.
export const custodyTab: HrTabInfo = {
  tab: 'Custody', path: '/custody', en: 'Custody & Assets', ar: 'العهدة والأصول', icon: 'inventory_2', hint: { en: 'Assets, vouchers and consumables', ar: 'الأصول والأذونات والمستهلكات' },
};

// Every tab a manager gives, in the order the Permissions tab shows them.
export const givenTabs: readonly HrTabInfo[] = [...hrTabs, custodyTab];

export const allHrTabs: readonly HrTab[] = givenTabs.map((t) => t.tab);

// The tabs a list names, in the order shown; anything that is not a tab left out.
export function hrTabsOf(names: readonly unknown[] | null | undefined): HrTab[] {
  const named = new Set(names ?? []);
  return allHrTabs.filter((t) => named.has(t));
}
