import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { EndOfDayApi, EndOfDayUndone, EndOfDayUndoPreview } from '../../core/costing/end-of-day.api';
import { NotifyService } from '../../core/ui/notify.service';
import { EndOfDayUndo, EndOfDayUndoDialog, undoneSummary } from './end-of-day-undo';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

const preview: EndOfDayUndoPreview = {
  date: '2026-11-04', submittedBy: 'Hany', submittedAtUtc: '2026-11-04T21:00:00Z', takings: 8_550, salesItems: 12, postedInvoices: 2,
  postedInvoicesTotal: 1_360, payouts: 1, payoutsTotal: 200, locked: false, zReports: 1,
};

describe('undoing the last closed day', () => {
  it('asks it as a danger, saying all it reverses, and gives the reason typed', () => {
    const close = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: MAT_DIALOG_DATA, useValue: preview }, { provide: MatDialogRef, useValue: { close } }] });
    const fixture = TestBed.createComponent(EndOfDayUndoDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(text(el.querySelector('h2')!)).toBe('warning Undo & reopen Wed 4 Nov 2026? إلغاء وفتح اليوم');
    expect(text(el.querySelector('.danger-text')!)).toContain(
      'Are you sure? This will reverse the cash taking and POS integration for this day so it can be recorded again correctly.',
    );
    expect([...el.querySelectorAll('.reverses li')].map(text)).toEqual([
      'savingsTakings in the safe توريد الإيرادL.E 8,550.00 voided',
      'point_of_saleSales summary, from the POS ملخص المبيعات12 items voided, stock put back',
      'receipt_longPurchase invoices posted from it الفواتير المرحلة2 · L.E 1,360.00 voided, to post again',
      'paymentsPayments & advances in the safe المدفوعات والسلف1 · L.E 200.00 voided',
    ]);
    expect(text(el.querySelector('p.muted')!)).toContain('The POS’s Z report is recorded again when the POS sends it again.');

    (fixture.componentInstance as unknown as { reason: string }).reason = '  Cash counted twice ';
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).includes('Undo & reopen day'))!.click();
    expect(close).toHaveBeenCalledWith({ reason: 'Cash counted twice' });
  });

  it('says none for what the day never made', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { ...preview, takings: null, salesItems: 0, postedInvoices: 0, payouts: 0, zReports: 0 } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(EndOfDayUndoDialog);
    fixture.detectChanges();
    expect([...(fixture.nativeElement as HTMLElement).querySelectorAll('.reverses li strong')].map(text)).toEqual(['None entered', 'None', 'None', 'None']);
  });

  describe('as a manager does it', () => {
    const open = vi.fn();
    const voidLast = vi.fn();
    const notify = { info: vi.fn(), error: vi.fn() };
    const undone: EndOfDayUndone = {
      day: { date: '2026-11-04' } as EndOfDayUndone['day'], takingsVoided: true, salesVoided: true, invoicesVoided: 2, payoutsVoided: 1, requestsRefused: 0,
    };

    function service() {
      TestBed.configureTestingModule({
        providers: [{ provide: MatDialog, useValue: { open } }, { provide: EndOfDayApi, useValue: { voidLast } }, { provide: NotifyService, useValue: notify }],
      });
      return TestBed.inject(EndOfDayUndo);
    }

    beforeEach(() => {
      open.mockReset();
      voidLast.mockReset();
      notify.info.mockReset();
      notify.error.mockReset();
    });

    it('undoes nothing when it is not confirmed', async () => {
      open.mockReturnValue({ afterClosed: () => of(undefined) });
      expect(await service().undo(preview)).toBeNull();
      expect(open.mock.lastCall![0]).toBe(EndOfDayUndoDialog);
      expect(voidLast).not.toHaveBeenCalled();
    });

    it('undoes the day seen, with why, and says what was reversed', async () => {
      open.mockReturnValue({ afterClosed: () => of({ reason: 'Cash counted twice' }) });
      voidLast.mockReturnValue(of(undone));
      expect(await service().undo(preview)).toBe(undone);
      expect(voidLast).toHaveBeenCalledWith('2026-11-04', 'Cash counted twice');
      expect(notify.info).toHaveBeenCalledWith(
        'Reopened 2026-11-04: takings voided, sales summary voided, 2 purchase invoices voided, 1 payment voided. · تم إلغاء تقفيل اليوم وإعادة فتحه.',
      );
    });

    it('says why when it is refused', async () => {
      open.mockReturnValue({ afterClosed: () => of({ reason: null }) });
      const refused = new Error('locked');
      voidLast.mockReturnValue(throwError(() => refused));
      expect(await service().undo(preview)).toBeNull();
      expect(notify.error).toHaveBeenCalledWith(refused, 'The day could not be undone.');
    });
  });

  it('says an undo that reversed nothing in a line', () => {
    expect(undoneSummary({ day: { date: '2026-11-04' } as EndOfDayUndone['day'], takingsVoided: false, salesVoided: false, invoicesVoided: 0, payoutsVoided: 0, requestsRefused: 2 }))
      .toBe('Reopened 2026-11-04: 2 requests refused.');
  });
});
