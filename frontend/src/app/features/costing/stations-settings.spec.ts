import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CostingApi, KitchenStation } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { StationsSettings } from './stations-settings';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const station = (over: Partial<KitchenStation>): KitchenStation => ({
  id: 's', name: 'S', nameAr: null, code: null, displayOrder: 1, targetVarianceTolerancePercent: null, isActive: true, isShared: false, materials: 0, recipes: 0, ...over,
});

const listed = [
  station({ id: 'grill', name: 'Grill', nameAr: 'المشويات', code: 'GRILL', displayOrder: 1, materials: 12, recipes: 8 }),
  station({ id: 'bar', name: 'Bar & Barista', code: 'BAR', displayOrder: 5, targetVarianceTolerancePercent: 2, materials: 9 }),
  station({ id: 'shared', name: 'Shared / General', code: 'SHARED', displayOrder: 7, isShared: true }),
];

describe('the kitchen and bar stations on cost settings', () => {
  const api = { stations: vi.fn(), saveStation: vi.fn(), deleteStation: vi.fn() };
  const notify = { info: vi.fn(), error: vi.fn() };
  let manager = true;

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: CostingApi, useValue: api },
        { provide: NotifyService, useValue: notify },
        { provide: AuthService, useValue: { can: () => manager } },
      ],
    });
    const fixture = TestBed.createComponent(StationsSettings);
    fixture.componentRef.setInput('tolerance', 5);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.stations.mockReturnValue(of(listed));
    notify.info.mockReset();
    manager = true;
  });

  it('lists each station with its code, own tolerance (or the settings’ as a hint) and what it keeps', async () => {
    const { el } = await render();
    const rows = [...el.querySelectorAll('table.stations tbody tr')];
    expect(rows.length).toBe(3);
    expect(rows.map((r) => (r.querySelector('input.code') as HTMLInputElement).value)).toEqual(['GRILL', 'BAR', 'SHARED']);
    const tolerance = (r: Element) => r.querySelectorAll('input.num')[1] as HTMLInputElement;
    expect([tolerance(rows[0]).value, tolerance(rows[0]).placeholder, tolerance(rows[1]).value]).toEqual(['', '5', '2']);
    expect(text(rows[0].querySelectorAll('td')[5])).toBe('12 · 8');
  });

  it('saves a station changed and a new one, a manager’s, and deletes one once asked', async () => {
    const { fixture, el, page } = await render();
    api.saveStation.mockReturnValue(of(listed[0]));
    const drafts = page['drafts']();
    drafts[1].tolerance = 1.5;
    await page['save'](drafts[1]);
    expect(api.saveStation).toHaveBeenCalledWith('bar', {
      name: 'Bar & Barista', nameAr: null, code: 'BAR', displayOrder: 5, targetVarianceTolerancePercent: 1.5, isActive: true,
    });

    page['add']();
    fixture.detectChanges();
    const added = page['drafts']().at(-1);
    expect([added.isNew, added.displayOrder]).toEqual([true, 8]);
    added.name = 'Bakery oven';
    added.code = 'oven';
    await page['save'](added);
    expect(api.saveStation).toHaveBeenLastCalledWith(added.id, expect.objectContaining({ name: 'Bakery oven', code: 'oven', targetVarianceTolerancePercent: null }));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.deleteStation.mockReturnValue(of(undefined));
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === 'Delete Grill')!.click();
    await new Promise((r) => setTimeout(r));
    expect(window.confirm).toHaveBeenCalledWith('Delete Grill? Its 12 materials and 8 dishes fall to the shared station.');
    expect(api.deleteStation).toHaveBeenCalledWith('grill');
  });

  it('shows anyone else the stations, nothing to change', async () => {
    manager = false;
    const { el } = await render();
    expect((el.querySelector('input.code') as HTMLInputElement).disabled).toBe(true);
    expect(el.querySelectorAll('td.actions button').length).toBe(0);
    expect(text(el.querySelector('p.muted.small')!)).toBe('A manager sets the stations.');
  });
});
