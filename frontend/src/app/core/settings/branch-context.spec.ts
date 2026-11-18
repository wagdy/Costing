import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { Me } from '../api/models';
import { AuthService } from '../auth/auth.service';
import { BranchContext, branchInterceptor, branchStorageKey } from './branch-context';
import { Company } from './company';
import { Branch, CompanyStructureApi, OperatingMode } from './company-structure';

function branch(id: string, name: string, isDefault = false): Branch {
  return { id, name, nameAr: null, type: 'Restaurant', isActive: true, isDefault, locations: 1 };
}

describe('the branch worked in', () => {
  const me = signal<Me | null>(null);
  const choices = vi.fn();

  function context(mode: OperatingMode, branchId: string | null = null) {
    me.set({ id: 'u-1', fullName: 'Wagdy', email: 'w@example.com', role: 'Manager', permissions: [], branchId });
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { me } },
        { provide: CompanyStructureApi, useValue: { choices } },
      ],
    });
    const company = TestBed.inject(Company);
    company.settings.update((s) => ({ ...s, operatingMode: mode }));
    const ctx = TestBed.inject(BranchContext);
    const reload = vi.spyOn(ctx as unknown as { reload(): void }, 'reload').mockImplementation(() => undefined);
    return { ctx, reload };
  }

  beforeEach(() => {
    localStorage.removeItem(branchStorageKey);
    choices.mockReset();
    choices.mockReturnValue(of({ mode: 'MultiBranch_Independent', branches: [branch('b-1', 'Otantik', true), branch('b-2', 'Tanta')] }));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem(branchStorageKey);
  });

  it('reads and offers nothing while the company has one branch', async () => {
    const { ctx } = context('SingleBranch_OpenSpace');
    await ctx.load();
    expect(choices).not.toHaveBeenCalled();
    expect([ctx.multi(), ctx.canChoose(), ctx.current()]).toEqual([false, false, null]);
  });

  it('lets one who works every branch choose, the first branch until they do', async () => {
    const { ctx, reload } = context('MultiBranch_Independent');
    await ctx.load();
    expect([ctx.canChoose(), ctx.current()?.name]).toEqual([true, 'Otantik']);
    ctx.choose('b-2');
    expect(localStorage.getItem(branchStorageKey)).toBe('b-2');
    expect([ctx.current()?.name, reload.mock.calls.length]).toEqual(['Tanta', 1]);
  });

  it('keeps a user kept to a branch in it, whatever was chosen', async () => {
    localStorage.setItem(branchStorageKey, 'b-1');
    const { ctx } = context('MultiBranch_CentralKitchen', 'b-2');
    await ctx.load();
    expect([ctx.canChoose(), ctx.current()?.name]).toEqual([false, 'Tanta']);
  });

  it('sends the branch chosen with each call to the API, and nothing else', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([branchInterceptor])), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);

    void firstValueFrom(http.get('/api/sales'));
    expect(backend.expectOne('/api/sales').request.headers.has('X-Branch-Id')).toBe(false);
    localStorage.setItem(branchStorageKey, 'b-2');
    void firstValueFrom(http.get('/api/sales'));
    void firstValueFrom(http.get('/assets/logo.svg'));
    expect(backend.expectOne('/api/sales').request.headers.get('X-Branch-Id')).toBe('b-2');
    expect(backend.expectOne('/assets/logo.svg').request.headers.has('X-Branch-Id')).toBe(false);
  });
});
