import { Component, input } from '@angular/core';
import { ApprovalChange } from '../../core/approvals/approvals.api';

// What a request changes, line by line, as the manager reads it: "Pay: 4,000.00 a month →
// 4,500.00 a month". Something new has only its value; something taken away is struck through.
@Component({
  selector: 'app-approval-changes',
  template: `
    <ul class="changes">
      @for (c of changes(); track $index) {
        <li>
          <span class="label">{{ c.label }}:</span>&ngsp;
          @if (c.before === null) {
            <span class="after">{{ c.after }}</span>
          } @else if (c.after === null) {
            <span class="before">{{ c.before }}</span>&ngsp;<span class="gone">removed · حُذف</span>
          } @else {
            <span class="before">{{ c.before }}</span>&ngsp;<span class="arrow" aria-label="becomes">→</span>&ngsp;<span class="after">{{ c.after }}</span>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    .changes {
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
      font-size: 0.9em;

      li + li {
        margin-top: 2px;
      }
    }
    .label {
      color: var(--mat-sys-on-surface-variant);
    }
    .before {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
    .after {
      font-weight: 600;
    }
    .arrow {
      color: var(--mat-sys-on-surface-variant);
    }
    .gone {
      font-size: 0.85em;
      color: var(--mat-sys-error);
    }
  `,
})
export class ApprovalChanges {
  readonly changes = input.required<ApprovalChange[]>();
}
