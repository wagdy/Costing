import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApprovalRequest, ApprovalsApi } from '../../core/approvals/approvals.api';
import { AuthService } from '../../core/auth/auth.service';
import { NotifyService } from '../../core/ui/notify.service';
import { ApprovalsPage } from './approvals-page';
import { Approvals } from './approvals';

function asked(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'q', module: 'Employee', action: 'Create', recordId: 'r', summary: 'New employee · Mona · Accountant · 4,000.00 a month, from 09:00',
    changes: [], reason: null, requestedBy: 'Mona', requestedAtUtc: '2026-10-08T09:00:00Z', status: 'Pending', decidedBy: null, decidedAtUtc: null,
    decisionNote: null, ...overrides,
  };
}
const advance = asked({ id: 'q1', module: 'Advance', recordId: 'a1', summary: 'Advance · Hassan · 500.00', reason: 'For rent' });
const raise = asked({
  id: 'q2', module: 'Employee', action: 'Update', recordId: 'e1', summary: 'Employee changed · Samir',
  changes: [{ label: 'Pay', before: '4,000.00 a month', after: '4,500.00 a month' }],
});
const earlier = asked({ id: 'q0', module: 'Custody', summary: 'Asset · Laptops · 2', status: 'Rejected', decidedBy: 'Omar',
  decidedAtUtc: '2026-10-08T08:00:00Z', decisionNote: 'Counted twice' });

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('the pending approvals', () => {
  const requests = vi.fn();
  const approve = vi.fn();
  const reject = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApprovalsApi, useValue: { requests, approve, reject } },
        { provide: NotifyService, useValue: notify },
        { provide: AuthService, useValue: { employeeActing: () => false, isSignedIn: () => true, me: () => null, can: () => true } },
      ],
    });
    const fixture = TestBed.createComponent(ApprovalsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const refresh = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const button = (within: Element, label: string) => [...within.querySelectorAll('button')].find((b) => text(b).includes(label))!;
    return { el, refresh, button };
  }

  beforeEach(() => {
    requests.mockReset().mockReturnValue(of({ pending: [advance, raise], decided: [earlier] }));
    approve.mockReset().mockReturnValue(of({ ...advance, status: 'Approved' }));
    reject.mockReset().mockReturnValue(of({ ...raise, status: 'Rejected' }));
    notify.info.mockReset();
  });

  it('lists what waits, with the module, the record, who asked and why, and the decisions before', async () => {
    const { el } = await render();

    expect(requests).toHaveBeenCalledWith(30);
    const rows = [...el.querySelectorAll('table')[0].querySelectorAll('tbody tr')];
    expect(rows.map((r) => [...r.querySelectorAll('td')].slice(0, 4).map(text))).toEqual([
      ['Advanceالسلفيات', 'Newجديد', 'Advance · Hassan · 500.00 Reason: For rent', 'Mona'],
      ['Employeeالموظفين', 'Changeتعديل', 'Employee changed · Samir Pay: 4,000.00 a month → 4,500.00 a month', 'Mona'],
    ]);
    expect(text(el.querySelectorAll('table')[1])).toContain('Rejected by Omar');
    expect(text(el.querySelectorAll('table')[1])).toContain('Counted twice');
    // The tab's count follows.
    expect(TestBed.inject(Approvals).pending()).toEqual([advance, raise]);
  });

  it('approves after asking in the row: an advance is recorded', async () => {
    const { el, refresh, button } = await render();
    const first = el.querySelectorAll('tbody tr')[0];

    button(first, 'Approve').click();
    await refresh();
    const confirm = el.querySelector('tr.confirm-row')!;
    expect(text(confirm)).toContain('Approve it? The advance is recorded: it comes off their pay for its month.');
    expect(approve).not.toHaveBeenCalled();

    button(confirm, 'Approve and add').click();
    await refresh();
    expect(approve).toHaveBeenCalledWith('q1');
    expect(notify.info).toHaveBeenCalledWith('Approved: it is recorded.');
    expect(requests).toHaveBeenCalledTimes(2);
  });

  it('approves a change, and shows an approved one as changed in the decisions', async () => {
    requests.mockReturnValue(of({ pending: [raise], decided: [asked({ ...raise, id: 'q9', status: 'Approved', decidedBy: 'Omar', decidedAtUtc: '2026-10-08T10:00:00Z' })] }));
    const { el, refresh, button } = await render();

    button(el.querySelectorAll('tbody tr')[0], 'Approve').click();
    await refresh();
    const confirm = el.querySelector('tr.confirm-row')!;
    expect(text(confirm)).toContain('Approve the change? The change is saved: a new salary or work schedule counts');
    button(confirm, 'Approve the change').click();
    await refresh();

    expect(approve).toHaveBeenCalledWith('q2');
    expect(notify.info).toHaveBeenCalledWith('Approved: it is changed.');
    expect(text(el.querySelectorAll('table')[1])).toContain('Changed by Omar');
  });

  it('rejects with a note for the one who asked', async () => {
    const { el, refresh, button } = await render();

    button(el.querySelectorAll('tbody tr')[1], 'Reject').click();
    await refresh();
    const input = el.querySelector<HTMLInputElement>('tr.confirm-row input')!;
    expect(document.activeElement).toBe(input);
    input.value = 'Not before the review';
    input.dispatchEvent(new Event('input'));
    button(el.querySelector('tr.confirm-row')!, 'Reject').click();
    await refresh();

    expect(reject).toHaveBeenCalledWith('q2', 'Not before the review');
    expect(notify.info).toHaveBeenCalledWith('Rejected: it stays as it is, and Mona can change it again.');
  });

  it('turns down a new employee with nothing made', async () => {
    const mona = asked({ id: 'q3', recordId: 'e9' });
    requests.mockReturnValue(of({ pending: [mona], decided: [] }));
    reject.mockReturnValue(of({ ...mona, status: 'Rejected' }));
    const { el, refresh, button } = await render();

    button(el.querySelectorAll('tbody tr')[0], 'Reject').click();
    await refresh();
    expect(text(el.querySelector('tr.confirm-row')!)).toContain('Reject: nothing is made.');
    button(el.querySelector('tr.confirm-row')!, 'Reject').click();
    await refresh();

    expect(reject).toHaveBeenCalledWith('q3', null);
    expect(notify.info).toHaveBeenCalledWith('Rejected: nothing is made.');
  });
});
