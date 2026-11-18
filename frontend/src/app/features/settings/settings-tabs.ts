import { SubNavTab } from '../shared/sub-nav';

// Settings' pages, a manager's: the company, the link to the restaurant's POS, the link to HR, and
// the month-end close (the books' lock).
export const settingsTabs: readonly SubNavTab[] = [
  { path: '/settings', icon: 'business', en: 'Company', ar: 'الشركة', fallback: true },
  { path: '/settings/pos-integration', icon: 'point_of_sale', en: 'POS Integration', ar: 'ربط نقطة البيع' },
  { path: '/settings/hr-integration', icon: 'groups', en: 'HR Integration', ar: 'ربط الموارد البشرية' },
  { path: '/settings/period-lock', icon: 'lock_clock', en: 'Period lock', ar: 'إقفال الدفاتر' },
];
