import { HrTab } from '../hr/hr-tabs';

// Who uses the system (its employees have the self-service portal instead): a manager, who does
// everything and decides what an accountant asks, or an accountant.
export type UserRole = 'Manager' | 'Accountant';

// GET /api/auth/me: who is signed in and what they may do. hrTabs: the HR & Payroll tabs they
// hold, every one for a manager, an accountant's as a manager ticked them.
export interface Me {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  permissions: string[];
  hrTabs?: HrTab[] | null;
}

// POST /api/auth/sign-in, and a password changed: the token, good until expiresAtUtc.
export interface SignInResponse {
  token: string;
  expiresAtUtc: string;
  user: Me;
}
