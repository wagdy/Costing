import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { BranchContext } from '../../core/settings/branch-context';
import { Company } from '../../core/settings/company';
import { CompanyStructure, CompanyStructureApi } from '../../core/settings/company-structure';
import { NotifyService } from '../../core/ui/notify.service';
import { CompanyStructurePage } from './company-structure-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const otantik = { id: 'b-1', name: 'Otantik', nameAr: 'أوتنتيك', type: 'Restaurant' as const, isActive: true, isDefault: true, locations: 1 };
const store = { id: 'l-1', branchId: 'b-1', name: 'Main Store', nameAr: 'المخزن الرئيسي', kind: 'MainStore' as const, isActive: true, isDefault: true };

function structure(over: Partial<CompanyStructure> = {}): CompanyStructure {
  return { mode: 'SingleBranch_OpenSpace', branches: [otantik], locations: [store], ...over };
}

describe('the company structure', () => {
  const api = { get: vi.fn(), setMode: vi.fn(), saveBranch: vi.fn(), saveLocation: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };
  const branches = { load: vi.fn().mockResolvedValue(undefined) };

  async function render(s: CompanyStructure) {
    api.get.mockReturnValue(of(s));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CompanyStructureApi, useValue: api },
        { provide: NotifyService, useValue: notify },
        { provide: BranchContext, useValue: branches },
      ],
    });
    const fixture = TestBed.createComponent(CompanyStructurePage);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    const button = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes(label))!;
    return { fixture, el, settle, button };
  }

  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    notify.info.mockReset();
    notify.error.mockReset();
    branches.load.mockClear();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows the four structures with their tips, the open-space shop current and the default', async () => {
    const { el } = await render(structure());
    const cards = [...el.querySelectorAll('.mode')];
    expect(cards.map((c) => text(c.querySelector('.mode-title strong')!))).toEqual([
      'Single branch, open space', 'Single branch with sub-stores', 'Several independent branches', 'Branches with a central kitchen',
    ]);
    expect(cards.map((c) => c.querySelector('app-info-tip button')!.getAttribute('aria-label'))).toEqual([
      'About Single branch, open space · فرع واحد بمساحة مفتوحة',
      'About Single branch with sub-stores · فرع واحد يحتوي على مخزن ومناطق تشغيل',
      'About Several independent branches · فروع متعددة تشتري وتعمل بشكل مستقل',
      'About Branches with a central kitchen · فروع متعددة يدعمها مطبخ مركزي / مخزن رئيسي',
    ]);
    expect(cards.map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
    expect(text(cards[0].querySelector('.badges')!)).toBe('check_circle Current · الحاليDefault · الافتراضي');
    expect(text(cards[3])).toContain('Soon · قريباً Requisitions, Dispatch & Bill, Receive');
    // One branch, its store implicit: no type, no new branch, no locations to keep.
    expect([...el.querySelectorAll('[aria-labelledby="branches-title"] tbody tr')].length).toBe(1);
    expect(el.querySelector('[aria-labelledby="branches-title"] mat-select')).toBeNull();
    expect([...el.querySelectorAll('button')].some((b) => text(b).includes('New branch'))).toBe(false);
    expect(text(el.querySelector('[aria-labelledby="locations-title"]')!)).toContain('An open-space shop keeps everything in one place');
    expect(el.querySelector('.apply')).toBeNull();
  });

  it('switches the company once a structure is chosen and applied, and tells the app', async () => {
    const { el, settle, button } = await render(structure());
    (el.querySelectorAll<HTMLElement>('.mode')[2]).click();
    await settle();
    expect(text(el.querySelector('.apply')!)).toContain('Switch the company to Several independent branches · فروع متعددة تشتري وتعمل بشكل مستقل?');

    api.setMode.mockReturnValue(of(structure({ mode: 'MultiBranch_Independent' })));
    button('Switch · تطبيق').click();
    await settle();
    expect(api.setMode).toHaveBeenCalledWith('MultiBranch_Independent');
    expect(TestBed.inject(Company).mode()).toBe('MultiBranch_Independent');
    expect(branches.load).toHaveBeenCalled();
    expect(el.querySelector('.apply')).toBeNull();
    expect([...el.querySelectorAll('[aria-labelledby="branches-title"] th')].map(text)).toContain('Type · النوع');
    expect(button('New branch')).toBeTruthy();
  });

  it('says why a structure was refused, and keeps the one there is', async () => {
    const { el, settle, button } = await render(structure({ mode: 'MultiBranch_Independent', branches: [otantik, { ...otantik, id: 'b-2', name: 'Tanta', isDefault: false }] }));
    (el.querySelectorAll<HTMLElement>('.mode')[0]).click();
    await settle();
    const refused = new HttpErrorResponse({ status: 422, error: { errors: ['Take Tanta out of use first: a single-branch company works in its first branch alone.'] } });
    api.setMode.mockReturnValue(throwError(() => refused));
    button('Switch · تطبيق').click();
    await settle();
    expect(notify.error).toHaveBeenCalledWith(refused, 'The structure could not be changed.');
    expect(el.querySelectorAll('[aria-labelledby="branches-title"] tbody tr').length).toBe(2);
  });

  it('adds a branch with several, and a location once the structure has them', async () => {
    const { el, settle, button } = await render(structure({ mode: 'MultiBranch_CentralKitchen' }));
    button('New branch').click();
    await settle();
    const name = el.querySelector<HTMLInputElement>('[aria-label="Branch name, row 2"]')!;
    name.value = 'Tanta';
    name.dispatchEvent(new Event('input'));
    await settle();
    api.saveBranch.mockReturnValue(of({}));
    api.get.mockReturnValue(of(structure({ mode: 'MultiBranch_CentralKitchen', branches: [otantik, { ...otantik, id: 'b-2', name: 'Tanta', isDefault: false }] })));
    el.querySelector<HTMLButtonElement>('[aria-label="Save Tanta"]')!.click();
    await settle();
    expect(api.saveBranch.mock.calls[0][1]).toEqual({ name: 'Tanta', nameAr: null, type: 'Restaurant', isActive: true });
    expect(notify.info).toHaveBeenCalledWith('Tanta saved. · تم حفظ الفرع.');

    button('New location').click();
    await settle();
    const location = el.querySelector<HTMLInputElement>('[aria-label="Location name, row 2"]')!;
    location.value = 'Kitchen';
    location.dispatchEvent(new Event('input'));
    await settle();
    api.saveLocation.mockReturnValue(of({}));
    el.querySelector<HTMLButtonElement>('[aria-label="Save Kitchen"]')!.click();
    await settle();
    expect(api.saveLocation.mock.calls[0][1]).toEqual({ branchId: 'b-1', name: 'Kitchen', nameAr: null, kind: 'Kitchen', isActive: true, stationIds: [] });
  });
});
