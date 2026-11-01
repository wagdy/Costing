import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { EmployeePicker } from '../../core/hr/employee-picker';
import { Employee, HrAdvanceInput } from '../../core/hr/hr.api';

export interface AdvanceDialogData {
  employees: Employee[];
  // A manager's is recorded at once; anyone else's waits for a manager.
  canApprove: boolean;
  // The workday: the advance's date unless another is chosen, and the latest.
  today: string;
}

// A new advance (سلفة جديدة), as HR records it: to an employee, coming off their pay, or to no one
// yet, a lump sum a manager gives out a share each on the Advances tab. Closes with what to send.
@Component({
  selector: 'app-advance-dialog',
  imports: [EmployeePicker, FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>New advance <span class="ar">سلفة جديدة</span></h2>
    <mat-dialog-content>
      <p class="muted">
        Recorded in HR and deducted from the employee's pay for its month.
        @if (!data.canApprove) {
          A manager approves it first.
        }
      </p>
      <div class="form">
        <div class="wide">
          <app-employee-picker [employees]="employed()" [(value)]="employeeId" [fill]="true" [none]="true"
            noneLabel="No one yet: give it out on the Advances tab"
            [hint]="employeeId() ? null : 'A lump sum handed out as advances: a manager gives it out on the Advances tab'" />
        </div>
        <mat-form-field>
          <mat-label>Amount · المبلغ</mat-label>
          <input matInput type="number" min="0" step="0.01" [(ngModel)]="amount" aria-label="Amount" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Date · التاريخ</mat-label>
          <input matInput type="date" [(ngModel)]="date" [max]="data.today" aria-label="Date" />
        </mat-form-field>
        <mat-form-field class="wide">
          <mat-label>Notes · ملاحظات</mat-label>
          <input matInput [(ngModel)]="notes" maxlength="500" aria-label="Notes" />
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!ready()" [mat-dialog-close]="result()">{{ data.canApprove ? 'Record' : 'Ask the manager' }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .form {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 12px;
    }
    .wide {
      grid-column: 1 / -1;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .ar {
      direction: rtl;
      unicode-bidi: isolate;
      margin-left: 6px;
      opacity: 0.75;
      font-size: 0.8em;
    }
  `,
})
export class AdvanceDialog {
  protected readonly data = inject<AdvanceDialogData>(MAT_DIALOG_DATA);
  protected readonly employeeId = signal<string | null>(null);
  protected amount: number | null = null;
  protected date = this.data.today;
  protected notes = '';
  // Made once, so a retry of the same advance finds the one made, or asked.
  private readonly advanceId = crypto.randomUUID();
  private readonly requestId = crypto.randomUUID();

  // Those employed on the day it is dated.
  protected readonly employed = computed(() => this.data.employees.filter((e) => !e.leftOn || e.leftOn >= this.data.today));

  protected ready(): boolean {
    return (this.amount ?? 0) > 0 && !!this.date && this.date <= this.data.today;
  }

  protected result(): HrAdvanceInput {
    return {
      advanceId: this.advanceId,
      requestId: this.requestId,
      amount: this.amount ?? 0,
      date: this.date,
      employeeId: this.employeeId(),
      notes: this.notes.trim() || null,
    };
  }
}
