import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Company } from './company';
import { Branch, CompanyStructureApi, isMultiBranch } from './company-structure';

// Where the user's choice of branch is kept, in this browser.
export const branchStorageKey = 'costing.branch';

function stored(): string | null {
  try {
    return localStorage.getItem(branchStorageKey);
  } catch {
    return null;
  }
}

// The branch the app works in. While the company has one branch there is nothing to choose, and
// nothing is shown. With several: a user kept to a branch works in it (their token says so); one
// who works every branch chooses at the top of the screen, sent with each call as X-Branch-Id.
@Injectable({ providedIn: 'root' })
export class BranchContext {
  private readonly api = inject(CompanyStructureApi);
  private readonly auth = inject(AuthService);
  private readonly company = inject(Company);

  // The branches in use.
  readonly branches = signal<Branch[]>([]);
  readonly chosen = signal<string | null>(stored());

  readonly multi = computed(() => isMultiBranch(this.company.mode()));
  // The branch the user is kept to; none for one who works every branch.
  readonly assigned = computed(() => this.auth.me()?.branchId ?? null);
  // The selector: several branches, and a user who may choose among them.
  readonly canChoose = computed(() => this.multi() && !this.assigned() && this.branches().length > 1);
  // The branch worked in: the user's own, the one chosen, or the first.
  readonly current = computed<Branch | null>(() => {
    const list = this.branches();
    const id = this.assigned() ?? this.chosen();
    return list.find((b) => b.id === id) ?? list.find((b) => b.isDefault) ?? list[0] ?? null;
  });

  // The branches in use, once the company has several; none to read otherwise.
  async load(): Promise<void> {
    if (!this.multi()) {
      this.branches.set([]);
      return;
    }
    try {
      this.branches.set((await firstValueFrom(this.api.choices())).branches);
    } catch {
      this.branches.set([]);
    }
  }

  // A branch chosen: kept, and every screen read again for it.
  choose(id: string): void {
    try {
      localStorage.setItem(branchStorageKey, id);
    } catch {
      // Not kept in this browser: chosen for now.
    }
    this.chosen.set(id);
    this.reload();
  }

  protected reload(): void {
    window.location.reload();
  }
}

// The branch chosen, with every call to the API. The API takes it only from a user who works
// every branch, in a company with several; anyone else's is ignored there.
export const branchInterceptor: HttpInterceptorFn = (request, next) => {
  const branch = request.url.startsWith('/api/') ? stored() : null;
  return next(branch ? request.clone({ setHeaders: { 'X-Branch-Id': branch } }) : request);
};
