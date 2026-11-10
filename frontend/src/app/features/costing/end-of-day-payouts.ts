import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { EmployeePicker } from '../../core/costing/employee-picker';
import { EndOfDay, EndOfDayApi, EndOfDayPayout, EndOfDayPayoutKind, photoProblem, shrinkPhoto } from '../../core/costing/end-of-day.api';
import { HrStaffApi } from '../../core/costing/hr-staff.api';
import { Employee } from '../../core/costing/staff';
import { errorMessage } from '../../core/http/error-message';
import { Company } from '../../core/settings/company';
import { ItemPicker, PickItem } from '../shared/item-picker';
import { PhotoSource, PhotoThumb } from './end-of-day-photo';

const round = (n: number) => Math.round(n * 100) / 100;

// What each kind of payment is called on its form.
export const payoutFormLabels: Record<
  EndOfDayPayoutKind,
  { label: string; receipt: string; receiptAr: string; amount: string; add: string; noReceipt: string; noPayee: string; noAmount: string }
> = {
  SupplierPayment: {
    label: 'supplier payment',
    receipt: 'Payment receipt / cash-out voucher',
    receiptAr: 'صورة إيصال سداد / إذن الصرف',
    amount: 'Amount paid in cash · المبلغ المدفوع نقداً',
    add: 'Add payment · إضافة السداد',
    noReceipt: 'Photograph the payment receipt or attach its file. · صوّر إيصال السداد أو أرفق ملفه.',
    noPayee: 'Choose the supplier from the list. · اختر المورد من القائمة.',
    noAmount: 'Enter the amount paid. · أدخل المبلغ المدفوع.',
  },
  EmployeeAdvance: {
    label: 'employee advance',
    receipt: 'Signed advance receipt',
    receiptAr: 'صورة إيصال صرف السلفة',
    amount: 'Advance amount · مبلغ السلفة',
    add: 'Add advance · إضافة السلفة',
    noReceipt: 'Photograph the signed advance receipt or attach its file. · صوّر إيصال صرف السلفة أو أرفق ملفه.',
    noPayee: 'Choose the employee from the list. · اختر الموظف من القائمة.',
    noAmount: 'Enter the advance amount. · أدخل مبلغ السلفة.',
  },
};

// One payment out of the till as it is handed in, or changed: its receipt (the camera, or a file),
// who was paid (a supplier from the list, or an employee from the staff), the amount and a short
// note. A new one is added with an id made here once, so it is never added twice; then the form is
// empty for the next.
@Component({
  selector: 'app-eod-payout-form',
  imports: [EmployeePicker, FormsModule, ItemPicker, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, PhotoThumb],
  template: `
    <div class="form" [class.editing]="!!payout()">
      <div class="photo">
        <input #camera type="file" accept="image/*" capture="environment" hidden (change)="pick(camera)" [attr.aria-label]="label() + ', take a photo'" />
        <input #upload type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden (change)="pick(upload)"
          [attr.aria-label]="label() + ', upload a file'" />
        <span class="receipt-label">{{ labels().receipt }}<span class="receipt-ar" lang="ar" dir="rtl">{{ labels().receiptAr }}</span></span>
        @if (source(); as s) {
          <app-photo-thumb [source]="s" [fileName]="fileName()" [contentType]="file()?.type ?? payout()?.receipt?.contentType ?? null" />
          <div class="photo-actions">
            <button mat-button type="button" (click)="camera.click()" [disabled]="saving()"><mat-icon>photo_camera</mat-icon> Retake · إعادة</button>
            <button mat-button type="button" (click)="upload.click()" [disabled]="saving()"><mat-icon>upload_file</mat-icon> Replace · استبدال</button>
          </div>
        } @else {
          <button mat-stroked-button type="button" class="big" (click)="camera.click()" [disabled]="saving()">
            <mat-icon>photo_camera</mat-icon> Take photo <span class="inline-ar">تصوير الإيصال</span>
          </button>
          <button mat-stroked-button type="button" class="big" (click)="upload.click()" [disabled]="saving()">
            <mat-icon>upload_file</mat-icon> Upload file <span class="inline-ar">رفع ملف</span>
          </button>
        }
      </div>
      <div class="fields">
        @if (kind() === 'SupplierPayment') {
          <app-item-picker [items]="suppliers()" [(value)]="payeeId" [label]="label() + ', supplier'" placeholder="Supplier · المورد" [disabled]="saving()" />
        } @else {
          <div class="employee">
            <app-employee-picker [employees]="activeEmployees()" [(value)]="payeeId" label="Employee · الموظف" [ariaLabel]="label() + ', employee'" [fill]="true"
              [disabled]="saving()" [hint]="hrLinked() ? 'From HR · من الموارد البشرية' : null"
              [emptyLabel]="hrLinked() ? 'No employees from HR yet: sync them in Settings → HR Integration' : 'No staff yet: add one below'" />
            @if (!hrLinked()) {
              @if (adding()) {
                <div class="add-staff">
                  <mat-form-field subscriptSizing="dynamic">
                    <mat-label>New staff member's name · اسم الموظف</mat-label>
                    <input matInput [(ngModel)]="newName" maxlength="200" (keydown.enter)="$event.preventDefault(); addStaff()" [attr.aria-label]="label() + ', new staff member'" />
                  </mat-form-field>
                  <button mat-button type="button" (click)="adding.set(false)" [disabled]="saving()">Cancel</button>
                  <button mat-stroked-button type="button" (click)="addStaff()" [disabled]="saving() || !newName.trim()"><mat-icon>person_add</mat-icon> Add · إضافة</button>
                </div>
              } @else {
                <button mat-button type="button" class="add-link" (click)="adding.set(true)" [disabled]="saving()">
                  <mat-icon>person_add</mat-icon> New staff member · موظف جديد
                </button>
              }
            }
          </div>
        }
        <mat-form-field subscriptSizing="dynamic" floatLabel="always">
          <mat-label>{{ labels().amount }}</mat-label>
          <input matInput type="number" min="0" step="any" inputmode="decimal" [(ngModel)]="amount" (ngModelChange)="touch()" placeholder="0.00"
            data-western-digits [attr.aria-label]="label() + ', amount'" />
          <span matTextSuffix>&nbsp;{{ company.currency() }}</span>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Note (optional) · ملاحظة</mat-label>
          <input matInput [(ngModel)]="note" (ngModelChange)="touch()" maxlength="200" [attr.aria-label]="label() + ', note'" />
        </mat-form-field>
      </div>
      <div class="actions">
        @if (payout()) {
          <button mat-button type="button" (click)="cancelled.emit()" [disabled]="saving()">Cancel · إلغاء</button>
          <button mat-flat-button type="button" (click)="save()" [disabled]="saving()"><mat-icon>check</mat-icon> Save · حفظ</button>
        } @else {
          @if (dirty()) {
            <button mat-button type="button" (click)="clear()" [disabled]="saving()">Clear · مسح</button>
          }
          <button mat-flat-button type="button" (click)="save()" [disabled]="saving()"><mat-icon>add</mat-icon> {{ labels().add }}</button>
        }
      </div>
      @if (saving()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (problem(); as p) {
        <p class="error" role="alert">{{ p }}</p>
      }
    </div>
  `,
  styleUrl: './costing.scss',
  styles: `
    .form {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px 16px;
      align-items: start;
      padding: 12px;
      border: 1px dashed var(--app-line-strong, #cbd5e1);
      border-radius: 14px;
      background: var(--mat-sys-surface-container-lowest);
    }
    .form.editing {
      border-style: solid;
      border-color: var(--mat-sys-primary);
    }
    .photo {
      display: grid;
      gap: 6px;
      justify-items: start;
      max-width: 240px;
      --thumb-size: 96px;
    }
    .receipt-label {
      display: grid;
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
    }
    .receipt-ar {
      unicode-bidi: isolate;
      opacity: 0.85;
    }
    .photo-actions {
      display: flex;
      flex-wrap: wrap;
    }
    .big {
      width: 100%;
      min-height: 44px;
      justify-content: flex-start;
    }
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 8px 12px;
      align-items: center;
    }
    .actions {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .employee {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .add-staff {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;

      mat-form-field {
        flex: 1 1 180px;
      }
    }
    .add-link {
      justify-self: start;
    }
    mat-progress-bar,
    .error {
      grid-column: 1 / -1;
    }
    @media (max-width: 599.98px) {
      .form {
        grid-template-columns: minmax(0, 1fr);
      }
      .photo {
        max-width: none;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
      }
      .receipt-label,
      .photo .big {
        grid-column: 1 / -1;
      }
      .actions button {
        flex: 1;
      }
    }
  `,
})
export class EodPayoutForm {
  private readonly api = inject(EndOfDayApi);
  private readonly hrStaff = inject(HrStaffApi);
  protected readonly company = inject(Company);

  readonly date = input.required<string>();
  readonly kind = input.required<EndOfDayPayoutKind>();
  readonly suppliers = input<readonly PickItem[]>([]);
  readonly employees = input<Employee[]>([]);
  // The staff come from HR: chosen from HR's, none added here.
  readonly hrLinked = input(false);
  // Someone added to the staff from here, while HR is not linked.
  readonly staffAdded = output<Employee>();
  // The payment being changed; none for a new one.
  readonly payout = input<EndOfDayPayout | null>(null);
  readonly saved = output<EndOfDay>();
  readonly cancelled = output<void>();
  // Something typed or chosen on a new one, not added yet.
  readonly pendingChange = output<boolean>();

  protected readonly file = signal<File | null>(null);
  protected readonly payeeId = signal<string | null>(null);
  protected amount: number | null = null;
  protected note = '';
  protected readonly saving = signal(false);
  protected readonly problem = signal<string | null>(null);
  private readonly version = signal(0);
  private id = crypto.randomUUID();

  protected readonly labels = computed(() => payoutFormLabels[this.kind()]);
  protected readonly label = computed(() => (this.payout() ? 'Payment' : `New ${this.labels().label}`));
  // Who can be advanced now: those still on the staff, and the one already chosen.
  protected readonly activeEmployees = computed(() =>
    [...this.employees(), ...this.added().filter((a) => !this.employees().some((e) => e.id === a.id))].filter(
      (e) => e.isActive || e.id === this.payout()?.employeeId,
    ),
  );
  protected readonly adding = signal(false);
  protected newName = '';
  private readonly added = signal<Employee[]>([]);

  // The receipt chosen here, else the one handed in.
  protected readonly source = computed<PhotoSource | null>(() => {
    const [file, payout, date] = [this.file(), this.payout(), this.date()];
    return file ?? (payout ? () => this.api.photo(date, payout.id) : null);
  });
  protected readonly fileName = computed(() => this.file()?.name ?? this.payout()?.receipt.fileName ?? '');

  protected readonly dirty = computed(() => {
    this.version();
    return !!this.file() || !!this.payeeId() || !!this.amount || !!this.note.trim();
  });

  // Filled from the payment being changed, once: the day saved again elsewhere leaves what is typed.
  private readonly payoutId = computed(() => this.payout()?.id ?? null);

  constructor() {
    effect(() => {
      this.payoutId();
      untracked(() => {
        const payout = this.payout();
        this.payeeId.set(payout ? (payout.supplierId ?? payout.employeeId) : null);
        this.amount = payout?.amount ?? null;
        this.note = payout?.note ?? '';
        this.file.set(null);
        this.touch();
      });
    });
    effect(() => {
      const dirty = this.dirty();
      if (!this.payout()) {
        untracked(() => this.pendingChange.emit(dirty));
      }
    });
  }

  protected touch(): void {
    this.version.update((v) => v + 1);
    this.problem.set(null);
  }

  // The camera's photo or the file chosen: lighter to send when it is a big photo.
  protected async pick(input: HTMLInputElement): Promise<void> {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) {
      return;
    }
    const file = await shrinkPhoto(chosen);
    const problem = photoProblem(file);
    if (problem) {
      this.problem.set(problem);
      return;
    }
    this.file.set(file);
    this.touch();
  }

  // Someone not on the staff yet, added by name and chosen; the same name again is the one there is.
  protected async addStaff(): Promise<void> {
    const name = this.newName.trim();
    if (!name) {
      return;
    }
    this.saving.set(true);
    this.problem.set(null);
    try {
      const made = await firstValueFrom(this.hrStaff.addLocal(crypto.randomUUID(), name, null));
      this.added.update((all) => [...all.filter((e) => e.id !== made.id), made]);
      this.payeeId.set(made.id);
      this.staffAdded.emit(made);
      this.newName = '';
      this.adding.set(false);
      this.touch();
    } catch (error) {
      this.problem.set(errorMessage(error, 'They could not be added to the staff. · تعذر إضافة الموظف.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected clear(): void {
    this.file.set(null);
    this.payeeId.set(null);
    this.amount = null;
    this.note = '';
    this.touch();
  }

  protected async save(): Promise<void> {
    const payout = this.payout();
    const amount = Number(this.amount);
    const labels = this.labels();
    const problem = !this.file() && !payout ? labels.noReceipt : !this.payeeId() ? labels.noPayee : !(amount > 0) ? labels.noAmount : null;
    if (problem) {
      this.problem.set(problem);
      return;
    }
    this.saving.set(true);
    this.problem.set(null);
    const entry = { payeeId: this.payeeId()!, amount: round(amount), note: this.note.trim() || null };
    try {
      let day: EndOfDay;
      if (!payout) {
        day = await firstValueFrom(this.api.addPayout(this.date(), this.kind(), this.id, entry, this.file()!));
        this.id = crypto.randomUUID();
        this.clear();
      } else {
        day = await firstValueFrom(this.api.changePayout(this.date(), this.kind(), payout.id, entry));
        const file = this.file();
        if (file) {
          day = await firstValueFrom(this.api.replacePayoutReceipt(this.date(), this.kind(), payout.id, file));
        }
      }
      this.saved.emit(day);
    } catch (error) {
      this.problem.set(errorMessage(error, 'The payment could not be saved. · تعذر حفظ المبلغ.'));
    } finally {
      this.saving.set(false);
    }
  }
}
