import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { ApprovalRequest } from '../../core/approvals/approvals.api';
import { AssetCategory, AssetItem, CustodyApi } from '../../core/custody/custody.api';
import { Employee, HrApi } from '../../core/hr/hr.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from '../approvals/approvals';
import { BusinessDay } from '../../core/ui/business-day';
import { AssetsPage } from './assets-page';
import { AssetDialog, AssetHistoryDialog, CheckInDialog, CheckOutDialog } from './custody-dialogs';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
// Element by element: the template leaves no space between them.
const cell = (el: Element): string =>
  [...el.childNodes]
    .map((n) => (n.nodeType === Node.ELEMENT_NODE ? cell(n as Element) : n.nodeType === Node.TEXT_NODE ? (n.textContent ?? '').trim() : ''))
    .filter(Boolean)
    .join(' ');

export function asset(id: string, name: string, extra: Partial<AssetItem> = {}): AssetItem {
  return {
    id, name, categoryId: 'technology', categoryName: 'Technology', isConsumable: true, unitCost: 35, quantity: 40, totalCost: 1_400, employeeId: null,
    employeeName: null, status: 'InStore', notes: null, createdBy: 'Omar', createdAtUtc: '2026-10-20T09:00:00Z',
    ...extra,
  };
}

const technology: AssetCategory = { id: 'technology', name: 'Technology', isConsumable: true, assets: 2, inCustody: 1 };
const devices: AssetCategory = { id: 'devices', name: 'Devices', isConsumable: false, assets: 1, inCustody: 0 };
const plates = asset('plates', 'Desk lamps', { status: 'InCustody', employeeId: 'hassan', employeeName: 'Hassan', quantity: 37, totalCost: 1_295 });
const glasses = asset('glasses', 'Water bottles', { quantity: 24, unitCost: 20, totalCost: 480 });
const forklift = asset('forklift', 'Forklift', { categoryId: 'devices', categoryName: 'Devices', isConsumable: false, quantity: 0, unitCost: 9_000, totalCost: 0, status: 'Broken' });

describe('the assets', () => {
  const assets = vi.fn();
  const employees = vi.fn();
  const open = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };
  const pending = signal<ApprovalRequest[]>([]);
  const approvals = {
    canApprove: signal(true),
    refresh: vi.fn(),
    requested: vi.fn(),
    pendingFor: (id: string) => pending().find((r) => r.recordId === id),
  };

  async function render(manage = true, employee = false) {
    TestBed.configureTestingModule({
      providers: [
        { provide: CustodyApi, useValue: { assets, categories: () => of([technology, devices]) } },
        { provide: HrApi, useValue: { employees } },
        { provide: AuthService, useValue: { employeeActing: () => employee, me: () => null, can: (p: string) => manage || p !== Permissions.HrManage } },
        { provide: Approvals, useValue: approvals },
        { provide: NotifyService, useValue: notify },
        { provide: MatDialog, useValue: { open } },
        { provide: BusinessDay, useValue: { today: () => Promise.resolve('2026-10-25') } },
      ],
    });
    const fixture = TestBed.createComponent(AssetsPage);
    const el = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      for (let i = 0; i < 3; i++) {
        fixture.detectChanges();
        await fixture.whenStable();
      }
      fixture.detectChanges();
    };
    await refresh();
    const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(0, 5).map(cell));
    return { el, refresh, rows, page: fixture.componentInstance as unknown as Record<string, any> };
  }

  beforeEach(() => {
    localStorage.clear();
    assets.mockReset().mockReturnValue(of([plates, glasses, forklift]));
    employees.mockReset().mockReturnValue(of([
      { id: 'hassan', name: 'Hassan', jobTitle: 'Checker', isActive: true },
      { id: 'gone', name: 'Gone', jobTitle: 'Checker', isActive: false },
    ] as Employee[]));
    open.mockReset();
    notify.info.mockReset();
    pending.set([]);
    approvals.requested.mockReset();
    approvals.canApprove.set(true);
  });

  it('lists what there is of each, its cost and whose custody it is in; what is gone only when asked', async () => {
    const { el, page, rows, refresh } = await render();

    expect(assets).toHaveBeenCalled();
    expect(rows()).toEqual([
      ['Desk lamps Technology · consumable', '37', '35.00', '1,295.00', 'Hassan In custody في العهدة'],
      ['Water bottles Technology · consumable', '24', '20.00', '480.00', 'In the store بالمخزن'],
    ]);
    expect(text(el.querySelector('.toolbar .muted')!)).toBe('2 assets · 1,775.00');

    page['showGone'].set(true);
    await refresh();
    expect(rows()[2]).toEqual(['Forklift Devices', '0', '9,000.00', '0.00', 'Broken كسر هالك']);
    // Gone: nothing to check in or out.
    expect(el.querySelectorAll('tbody tr')[2].querySelector('button[aria-label^="Check"]')).toBeNull();

    page['category'].set('devices');
    await refresh();
    expect(rows().map((r) => r[0])).toEqual(['Forklift Devices']);
  });

  it('checks in to one employed now, checks out, and says when it waits for a manager', async () => {
    const { el, page } = await render();
    const glassesRow = el.querySelectorAll('tbody tr')[1];
    expect([...glassesRow.querySelectorAll('button')].map(text)).toEqual(['history', 'login In', 'logout Out', 'edit']);
    // In custody: out, not in.
    expect([...el.querySelectorAll('tbody tr')[0].querySelectorAll('button')].map(text)).toEqual(['history', 'logout Out', 'edit']);

    open.mockReturnValue({ afterClosed: () => of({ outcome: 'Applied', asset: glasses, voucher: null, request: null }) });
    await page['checkIn'](glasses);
    expect(open.mock.lastCall![0]).toBe(CheckInDialog);
    expect(open.mock.lastCall![1].data).toMatchObject({ asset: glasses, today: '2026-10-25', canApprove: true });
    expect(open.mock.lastCall![1].data.employees.map((e: Employee) => e.id)).toEqual(['hassan']);
    expect(notify.info).toHaveBeenLastCalledWith('Water bottles checked in.');

    open.mockReturnValue({ afterClosed: () => of({ outcome: 'Applied', asset: plates, voucher: {}, request: null }) });
    await page['checkOut'](plates);
    expect(open.mock.lastCall![0]).toBe(CheckOutDialog);
    expect(notify.info).toHaveBeenLastCalledWith('Desk lamps checked out.');

    open.mockReturnValue({ afterClosed: () => of({ outcome: 'Requested', request: { id: 'r', action: 'Update' } }) });
    await page['checkOut'](plates);
    expect(approvals.requested).toHaveBeenCalled();

    // Cancelled: nothing said, nothing read again.
    const reads = assets.mock.calls.length;
    open.mockReturnValue({ afterClosed: () => of(undefined) });
    await page['edit'](plates);
    expect(open.mock.lastCall![0]).toBe(AssetDialog);
    expect(open.mock.lastCall![1].data).toEqual({ asset: plates, categories: [technology, devices], canApprove: true, costHidden: false });
    expect(assets.mock.calls.length).toBe(reads);

    page['history'](plates);
    expect(open.mock.lastCall![0]).toBe(AssetHistoryDialog);
    expect(open.mock.lastCall![1].data).toEqual({ assetId: 'plates' });
  });

  it('locks an asset a manager is asked about, and offers no changes to whoever only sees it', async () => {
    pending.set([{ id: 'r1', module: 'Custody', action: 'Update', recordId: 'plates', summary: 'Out of Hassan’s custody, lost · Desk lamps × 1', requestedBy: 'Sara' }] as ApprovalRequest[]);
    const { el } = await render();
    const platesRow = el.querySelectorAll('tbody tr')[0];
    expect(platesRow.querySelector('mat-icon.locked')).not.toBeNull();
    expect([...platesRow.querySelectorAll('button')].map(text)).toEqual(['history']);

    TestBed.resetTestingModule();
    pending.set([]);
    const viewer = await render(false);
    expect([...viewer.el.querySelectorAll('tbody button')].map(text)).toEqual(['history', 'history']);
    expect([...viewer.el.querySelectorAll('.toolbar button')].map(text).some((t) => t.includes('Add an asset'))).toBe(false);
  });

  it('shows an employee working the tab in the portal no costs, and asks none of them for an asset they change', async () => {
    assets.mockReturnValue(of([{ ...plates, unitCost: null, totalCost: null }, { ...glasses, unitCost: null, totalCost: null }]));
    const { el, page } = await render(true, true);
    expect([...el.querySelectorAll('thead th')].map((th) => th.childNodes[0].textContent!.trim())).toEqual(['Asset', 'How many', 'Custody', 'Actions']);
    expect(text(el.querySelector('.toolbar .muted')!)).toBe('2 assets');
    expect(el.textContent).not.toMatch(/\d\.\d{2}/);

    open.mockReturnValue({ afterClosed: () => of(undefined) });
    await page['edit'](plates);
    expect(open.mock.lastCall![1].data.costHidden).toBe(true);
  });
});
