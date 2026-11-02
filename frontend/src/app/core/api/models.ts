import { CostingTab } from '../costing/costing-tabs';

// Who uses the system: a manager, who does everything, decides what the others ask and gives
// each their sections; an accountant (purchases, the safe, the reports); a cost controller
// (recipes, the menu, sales, the reports); a storekeeper (the stock: purchases in, counts,
// production, waste).
export type UserRole = 'Manager' | 'Accountant' | 'CostController' | 'Storekeeper';

// GET /api/auth/me: who is signed in and what they may do. tabs: the sections they work, every
// one for a manager, anyone else's as a manager ticked them (their role's until then).
export interface Me {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  permissions: string[];
  tabs?: CostingTab[] | null;
}

// POST /api/auth/sign-in, and a password changed: the token, good until expiresAtUtc.
export interface SignInResponse {
  token: string;
  expiresAtUtc: string;
  user: Me;
}
