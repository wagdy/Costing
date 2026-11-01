import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApprovalsApi } from '../../core/approvals/approvals.api';
import { AuthService } from '../../core/auth/auth.service';
import { Permissions } from '../../core/auth/permissions';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals, pendingLabel } from './approvals';

describe('what waits for a manager', () => {
  const requests = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  function service(auth: { signedIn?: boolean; manager?: boolean; manage?: boolean } = {}): Approvals {
    const { signedIn = true, manager = false, manage = true } = auth;
    TestBed.configureTestingModule({
      providers: [
        { provide: ApprovalsApi, useValue: { requests } },
        { provide: NotifyService, useValue: notify },
        {
          provide: AuthService,
          useValue: {
            employeeActing: () => !signedIn,
            isSignedIn: () => signedIn,
            me: () => null,
            can: (p: string) => (p === Permissions.ApprovalDecide ? manager : p === Permissions.HrManage ? manage : true),
          },
        },
      ],
    });
    return TestBed.inject(Approvals);
  }

  beforeEach(() => {
    requests.mockReset().mockReturnValue(of({ pending: [], decided: [] }));
    notify.info.mockReset();
    notify.error.mockReset();
  });

  it('says a save went to a manager, marks the record, and lists the new ones waiting to be made', async () => {
    const approvals = service();
    const advance = { id: 'q1', module: 'Advance', action: 'Create', recordId: 'a1', requestedBy: 'Mona' };
    const change = { id: 'q2', module: 'Employee', action: 'Update', recordId: 'e1', requestedBy: 'Mona' };
    requests.mockReturnValue(of({ pending: [advance, change], decided: [] }));

    await approvals.requested({ outcome: 'Requested', request: change as never });

    expect(notify.info).toHaveBeenCalledWith('Change submitted to the manager for approval. It stays as it was until then.');
    expect(approvals.waitingToBeMade('Advance')).toEqual([advance]);
    expect(approvals.waitingToBeMade('Employee')).toEqual([]);
    expect(approvals.pendingFor('e1')).toEqual(change);
    expect(approvals.pendingFor('e2')).toBeUndefined();
    expect(approvals.canApprove()).toBe(false);
  });

  it('asks nothing for an employee in the portal, nor for whoever only sees HR', async () => {
    await service({ signedIn: false }).refresh();
    TestBed.resetTestingModule();
    await service({ manage: false }).refresh();

    expect(requests).not.toHaveBeenCalled();
  });

  it('keeps the screens working when the requests cannot be read', async () => {
    const approvals = service({ manager: true });
    requests.mockReturnValue(throwError(() => new Error('down')));

    await approvals.refresh();

    expect(approvals.pending()).toEqual([]);
    expect(approvals.canApprove()).toBe(true);
  });

  it('marks a new one as waiting, and a change as asked for', () => {
    expect(pendingLabel({ action: 'Create' } as never).en).toBe('Waiting for approval');
    expect(pendingLabel({ action: 'Update' } as never).en).toBe('Change requested');
  });
});
