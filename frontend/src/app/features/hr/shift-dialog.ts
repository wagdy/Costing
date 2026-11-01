import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { HrApi, ShiftTone, WorkShift, shiftTones } from '../../core/hr/hr.api';
import { errorMessage } from '../../core/http/error-message';

// "08:00–16:00", "+1" when it ends the next morning.
export function shiftHours(shift: Pick<WorkShift, 'startsAt' | 'endsAt'>): string {
  const start = shift.startsAt.slice(0, 5);
  const end = shift.endsAt.slice(0, 5);
  return `${start}–${end}${end <= start ? ' +1' : ''}`;
}

// A time as typed, as "HH:mm": "8", "0800", "8:30", "16:30", "4pm", "4:30 PM", Arabic digits too.
// Null when it is not one.
export function parseTime(typed: string): string | null {
  const text = typed
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, '');
  const match = /^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm|ص|م)?$/.exec(text);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const half = match[3];
  if (half) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    hour = (hour % 12) + (half === 'pm' || half === 'م' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export interface ShiftDialogData {
  shifts: WorkShift[];
}

// The shifts (الشفتات): each with its hours and its colour on the roster, added, changed, or
// deleted while no day is rostered on it. Closes with whether anything changed.
@Component({
  selector: 'app-shift-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatTooltipModule],
  template: `
    <h2 mat-dialog-title>Shifts <span class="inline-ar">الشفتات</span></h2>
    <mat-dialog-content>
      @if (shifts().length) {
        <ul class="shifts">
          @for (s of shifts(); track s.id) {
            <li [class.editing]="editing() === s.id">
              <span class="swatch" [class]="'tone-' + s.tone"></span>
              <span class="what">
                <strong>{{ s.name }}</strong>
                <span class="muted small">{{ hours(s) }} · {{ s.minutes / 60 }}h@if (s.rosteredDays) { · on {{ s.rosteredDays }} {{ s.rosteredDays === 1 ? 'day' : 'days' }}}</span>
              </span>
              <button mat-icon-button (click)="edit(s)" matTooltip="Edit" [attr.aria-label]="'Edit ' + s.name"><mat-icon>edit</mat-icon></button>
              <button mat-icon-button class="danger" (click)="remove(s)" [disabled]="s.rosteredDays > 0 || saving()"
                [matTooltip]="s.rosteredDays ? 'On the roster: put those days on another shift first' : 'Delete'" [attr.aria-label]="'Delete ' + s.name">
                <mat-icon>delete</mat-icon>
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="muted">
          <span class="note-ar" lang="ar" dir="rtl">لا توجد شفتات بعد. أضف الصباحي والمسائي والليلي بمواعيدها.</span>
          No shifts yet. Add the morning, the evening and the night, with their hours.
        </p>
      }

      <h3>{{ editing() ? 'Edit the shift · تعديل الشفت' : 'Add a shift · إضافة شفت' }}</h3>
      <div class="form">
        <mat-form-field class="wide">
          <mat-label>Name · الاسم</mat-label>
          <input matInput [(ngModel)]="name" maxlength="50" placeholder="Morning, evening, night" aria-label="Name" />
        </mat-form-field>
        <!-- Typed, not a browser's time picker: one that also wants AM or PM leaves its value empty until every part is filled. -->
        <mat-form-field>
          <mat-label>Starts · يبدأ</mat-label>
          <input matInput [(ngModel)]="startsAt" (blur)="tidy('startsAt')" inputmode="numeric" placeholder="08:00" maxlength="10" aria-label="Starts" />
          <mat-hint>24-hour, like 08:00 · مثل 08:00</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Ends · ينتهي</mat-label>
          <input matInput [(ngModel)]="endsAt" (blur)="tidy('endsAt')" inputmode="numeric" placeholder="16:00" maxlength="10" aria-label="Ends" />
          @if (overnight()) {
            <mat-hint>The next morning · صباح اليوم التالي</mat-hint>
          } @else {
            <mat-hint>Like 16:00 · مثل 16:00</mat-hint>
          }
        </mat-form-field>
        <div class="tones wide" role="radiogroup" aria-label="Colour">
          <span class="muted small">Colour · اللون</span>
          @for (t of tones; track t) {
            <button type="button" class="tone" [class]="'tone-' + t" [class.on]="tone === t" role="radio" [attr.aria-checked]="tone === t" [attr.aria-label]="t" (click)="tone = t"></button>
          }
        </div>
      </div>
      @if (saving()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (error(); as e) {
        <p class="error" role="alert">{{ e }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (editing()) {
        <button mat-button (click)="reset()">Cancel the edit</button>
      }
      <!-- Never disabled for what is missing: pressed, it says what. -->
      <button mat-stroked-button (click)="save()" [disabled]="saving()">
        <mat-icon>{{ editing() ? 'check' : 'add' }}</mat-icon> {{ editing() ? 'Save · حفظ' : 'Add · إضافة' }}
      </button>
      <button mat-flat-button (click)="ref.close(changed)">Done · تم</button>
    </mat-dialog-actions>
  `,
  styleUrl: '../shared/pages.scss',
  styles: `
    .shifts {
      display: grid;
      gap: 6px;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;

      li {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 6px 6px 12px;
        border-radius: 12px;
        border: 1px solid var(--app-line);

        &.editing {
          border-color: var(--mat-sys-primary);
        }
      }
    }
    .what {
      display: grid;
      flex: 1;
      min-width: 0;
    }
    .swatch {
      flex: none;
      width: 14px;
      height: 14px;
      border-radius: 5px;
      background: var(--tone-fg);
    }
    h3 {
      margin: 8px 0;
      font: var(--mat-sys-title-small);
    }
    .form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 12px;
    }
    .wide {
      grid-column: span 2;
    }
    .tones {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .tone {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: 2px solid transparent;
      background: var(--tone-bg);
      box-shadow: inset 0 0 0 6px var(--tone-bg), inset 0 0 0 30px var(--tone-fg);
      cursor: pointer;

      &.on {
        border-color: var(--mat-sys-on-surface);
      }
      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }
    .small {
      font-size: 0.85em;
    }
    .danger {
      color: var(--mat-sys-error);

      // On the roster, so not deleted: as faint as any button that cannot be pressed.
      &:disabled {
        color: var(--mat-sys-on-surface);
        opacity: 0.38;
      }
    }
    @media (max-width: 600px) {
      .form {
        grid-template-columns: minmax(0, 1fr);
      }
      .wide {
        grid-column: auto;
      }
    }
  `,
})
export class ShiftDialog {
  private readonly api = inject(HrApi);
  protected readonly ref = inject<MatDialogRef<ShiftDialog, boolean>>(MatDialogRef);
  protected readonly shifts = signal(inject<ShiftDialogData>(MAT_DIALOG_DATA).shifts);
  protected readonly tones = shiftTones;
  protected readonly hours = shiftHours;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  // The shift being edited; none while adding one.
  protected readonly editing = signal<string | null>(null);
  protected changed = false;

  protected name = '';
  protected startsAt = '';
  protected endsAt = '';
  protected tone: ShiftTone = 'Sky';

  protected edit(shift: WorkShift): void {
    this.editing.set(shift.id);
    this.name = shift.name;
    this.startsAt = shift.startsAt.slice(0, 5);
    this.endsAt = shift.endsAt.slice(0, 5);
    this.tone = shift.tone;
  }

  protected reset(): void {
    this.editing.set(null);
    this.name = '';
    this.startsAt = '';
    this.endsAt = '';
    this.tone = shiftTones[this.shifts().length % shiftTones.length];
  }

  // Ends at or before it starts: into the next morning.
  protected overnight(): boolean {
    const start = parseTime(this.startsAt);
    const end = parseTime(this.endsAt);
    return !!start && !!end && end <= start;
  }

  // As typed, made "HH:mm" once it is one.
  protected tidy(field: 'startsAt' | 'endsAt'): void {
    const time = parseTime(this[field]);
    if (time) {
      this[field] = time;
    }
  }

  protected async save(): Promise<void> {
    const start = parseTime(this.startsAt);
    const end = parseTime(this.endsAt);
    const missing = !this.name.trim()
      ? 'Give the shift its name. · اكتب اسم الشفت'
      : !start
        ? 'Enter when it starts, like 08:00. · أدخل وقت البداية'
        : !end
          ? 'Enter when it ends, like 16:00. · أدخل وقت النهاية'
          : null;
    if (missing) {
      this.error.set(missing);
      return;
    }
    await this.act(async () => {
      const id = this.editing() ?? crypto.randomUUID();
      const saved = await firstValueFrom(this.api.saveShift(id, { name: this.name.trim(), startsAt: `${start}:00`, endsAt: `${end}:00`, tone: this.tone }));
      this.shifts.update((list) => [...list.filter((s) => s.id !== id), saved].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
      this.reset();
    });
  }

  protected async remove(shift: WorkShift): Promise<void> {
    await this.act(async () => {
      await firstValueFrom(this.api.deleteShift(shift.id));
      this.shifts.update((list) => list.filter((s) => s.id !== shift.id));
      if (this.editing() === shift.id) {
        this.reset();
      }
    });
  }

  private async act(call: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await call();
      this.changed = true;
    } catch (error) {
      this.error.set(errorMessage(error, 'The shift could not be saved.'));
    } finally {
      this.saving.set(false);
    }
  }
}
