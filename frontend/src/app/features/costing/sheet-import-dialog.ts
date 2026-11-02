import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Observable, firstValueFrom } from 'rxjs';
import { SheetChange, SheetImportResult } from '../../core/costing/costing.api';
import { errorMessage } from '../../core/http/error-message';
import { saveBlob } from '../../core/ui/save-blob';

// What the dialog imports: its name for what is on the sheet, its rules, the template to start
// from, and the upload itself.
export interface SheetImportData {
  title: { en: string; ar: string };
  // "material", "materials", "خامة".
  noun: { one: string; many: string; ar: string };
  rules: { en: string; ar: string }[];
  templateName: string;
  template: () => Observable<Blob>;
  upload: (file: File) => Observable<SheetImportResult>;
}

export const sheetChangeLabels: Record<SheetChange, { en: string; ar: string }> = {
  Name: { en: 'name', ar: 'الاسم' },
  Code: { en: 'code', ar: 'الكود' },
  Category: { en: 'category', ar: 'القسم' },
  PurchaseUnit: { en: 'purchase unit', ar: 'وحدة الشراء' },
  Cost: { en: 'cost', ar: 'التكلفة' },
  ReorderLevel: { en: 'reorder level', ar: 'حد الطلب' },
  Yield: { en: 'yield', ar: 'نسبة الصافي' },
  NameAr: { en: 'Arabic name', ar: 'الاسم بالعربي' },
  Unit: { en: 'unit', ar: 'الوحدة' },
};

// Importing from Excel (الاستيراد من إكسل): what a sheet does, its template, and the file dropped or
// chosen; then what it did: those added, those changed and in what, those as the sheet has them
// already, and each row skipped by its number on the sheet and why, for the sheet to be put right
// and imported again. Closes with whether anything was added or changed, for the list to be read
// again.
@Component({
  selector: 'app-sheet-import-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>{{ data.title.en }} <span class="inline-ar">{{ data.title.ar }}</span></h2>
    <mat-dialog-content>
      @if (result(); as r) {
        <div class="counts" aria-label="What the import did">
          <span class="count added"><strong>{{ r.created.length }}</strong> added <span class="ar">أُضيف</span></span>
          <span class="count changed"><strong>{{ r.updated.length }}</strong> changed <span class="ar">عُدّل</span></span>
          <span class="count same"><strong>{{ r.unchanged }}</strong> unchanged <span class="ar">بلا تغيير</span></span>
          <span class="count skipped" [class.bad]="r.skipped.length"><strong>{{ r.skipped.length }}</strong> skipped <span class="ar">لم يُستورد</span></span>
        </div>
        @if (summary(r); as said) {
          <p class="summary">{{ said }}</p>
        }
        @if (r.categoriesAdded.length) {
          <p class="muted">New categories · أقسام جديدة: {{ r.categoriesAdded.join(', ') }}</p>
        }
        @if (r.updated.length) {
          <h3>Changed <span class="inline-ar">ما تم تعديله</span></h3>
          <div class="table-wrap">
            <table class="grid changed-rows">
              <thead>
                <tr>
                  <th class="num">Row<span class="ar">الصف</span></th>
                  <th>{{ capital(data.noun.one) }}<span class="ar">{{ data.noun.ar }}</span></th>
                  <th>What changed<span class="ar">ما تغيّر</span></th>
                </tr>
              </thead>
              <tbody>
                @for (u of r.updated; track u.row) {
                  <tr>
                    <td class="num">{{ u.row }}</td>
                    <td>{{ u.name }}</td>
                    <td>{{ changes(u.changes) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        @if (r.skipped.length) {
          <h3>{{ r.skipped.length === 1 ? '1 row skipped' : r.skipped.length + ' rows skipped' }} <span class="inline-ar">صفوف لم تُستورد</span></h3>
          <div class="table-wrap">
            <table class="grid skipped-rows">
              <thead>
                <tr>
                  <th class="num">Row<span class="ar">الصف</span></th>
                  <th>{{ capital(data.noun.one) }}<span class="ar">{{ data.noun.ar }}</span></th>
                  <th>Why<span class="ar">السبب</span></th>
                </tr>
              </thead>
              <tbody>
                @for (s of r.skipped; track s.row) {
                  <tr>
                    <td class="num">{{ s.row }}</td>
                    <td>{{ s.name ?? '—' }}</td>
                    <td>
                      {{ s.reason }}
                      @if (s.reasonAr) {
                        <div class="reason-ar" lang="ar" dir="rtl">{{ s.reasonAr }}</div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="muted">Put those rows right on the sheet and import it again: the rest are there already. · صحّح هذه الصفوف واستورد الملف مرة أخرى.</p>
        }
      } @else {
        <ul class="rules">
          @for (rule of data.rules; track rule.en) {
            <li>{{ rule.en }} <span class="rule-ar" lang="ar" dir="rtl">{{ rule.ar }}</span></li>
          }
        </ul>
        <div
          class="drop"
          [class.over]="dragging()"
          (dragover)="over($event)"
          (dragleave)="dragging.set(false)"
          (drop)="dropped($event)"
          role="group"
          aria-label="The Excel file to import"
        >
          <mat-icon>upload_file</mat-icon>
          <p>Drop the Excel file here, or choose it. <span class="inline-ar">اسحب ملف الإكسل هنا أو اختره.</span></p>
          <button mat-flat-button type="button" (click)="picker.click()" [disabled]="busy()">
            <mat-icon>folder_open</mat-icon> Choose a file <span class="inline-ar">اختر ملفًا</span>
          </button>
          <input #picker type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="picked(picker)"
            aria-label="Excel file to import" />
        </div>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
          <p class="muted">Importing {{ fileName() }}… · جارٍ الاستيراد</p>
        }
        @if (error(); as message) {
          <p class="error" role="alert"><strong>The file could not be imported. · تعذّر استيراد الملف.</strong><br />{{ message }}</p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" class="template" (click)="downloadTemplate()" [disabled]="busy()">
        <mat-icon>download</mat-icon> Excel template <span class="inline-ar">نموذج إكسل</span>
      </button>
      <span class="spacer"></span>
      @if (result()) {
        <button mat-button type="button" (click)="again()">Import another file <span class="inline-ar">ملف آخر</span></button>
        <button mat-flat-button type="button" (click)="close()">Done <span class="inline-ar">تم</span></button>
      } @else {
        <button mat-button type="button" (click)="close()" [disabled]="busy()">Cancel <span class="inline-ar">إلغاء</span></button>
      }
    </mat-dialog-actions>
  `,
  styleUrl: './costing.scss',
  styles: `
    .rules {
      margin: 0 0 16px;
      padding-inline-start: 20px;

      li {
        margin-bottom: 6px;
      }
    }
    .rule-ar,
    .reason-ar {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.92em;
    }
    .drop {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 24px 16px;
      margin-bottom: 12px;
      border: 2px dashed var(--app-line-strong);
      border-radius: 16px;
      text-align: center;
      transition:
        background 120ms,
        border-color 120ms;

      > mat-icon {
        width: 40px;
        height: 40px;
        font-size: 40px;
        color: var(--mat-sys-primary);
      }
      p {
        margin: 0;
      }
    }
    .drop.over {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-primary-container);
    }
    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .count {
      padding: 6px 12px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-large);

      strong {
        font-size: 1.15em;
        margin-inline-end: 2px;
      }
      .ar {
        display: inline;
        margin-inline-start: 4px;
        opacity: 0.75;
      }
    }
    .count.bad {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .summary {
      font: var(--mat-sys-title-small);
    }
    h3 {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-small);
    }
    .spacer {
      flex: 1;
    }
  `,
})
export class SheetImportDialog {
  protected readonly data = inject<SheetImportData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<SheetImportDialog, boolean>>(MatDialogRef);

  protected readonly busy = signal(false);
  protected readonly dragging = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly fileName = signal('');
  protected readonly result = signal<SheetImportResult | null>(null);
  // Whether any import here added or changed something: the list behind is read again.
  private changed = false;

  protected over(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected dropped(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void this.import(file);
    }
  }

  // The picker is cleared, so the same file can be chosen again once it is put right.
  protected picked(picker: HTMLInputElement): void {
    const file = picker.files?.[0];
    picker.value = '';
    if (file) {
      void this.import(file);
    }
  }

  protected async import(file: File): Promise<void> {
    if (this.busy()) {
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      this.error.set(`${file.name} is not an Excel file (.xlsx): save it as an Excel workbook first. · الملف ليس ملف إكسل (.xlsx).`);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.fileName.set(file.name);
    try {
      const result = await firstValueFrom(this.data.upload(file));
      this.changed ||= result.created.length > 0 || result.updated.length > 0;
      this.result.set(result);
    } catch (error) {
      this.error.set(errorMessage(error, 'Please try again. · حاول مرة أخرى.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async downloadTemplate(): Promise<void> {
    this.busy.set(true);
    try {
      saveBlob(await firstValueFrom(this.data.template()), this.data.templateName);
    } catch (error) {
      this.error.set(errorMessage(error, 'The template could not be downloaded. · تعذّر تنزيل النموذج.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected again(): void {
    this.result.set(null);
    this.error.set(null);
  }

  protected close(): void {
    this.ref.close(this.changed);
  }

  // Said only when nothing was added or changed: the counts above say the rest.
  protected summary(r: SheetImportResult): string | null {
    if (r.created.length || r.updated.length) {
      return null;
    }
    return r.unchanged
      ? `Nothing to change: the ${this.data.noun.many} are as the sheet has them. · لا شيء للتعديل: البيانات كما في الملف.`
      : `No ${this.data.noun.many} imported. · لم يُستورد شيء.`;
  }

  protected changes(changes: SheetChange[]): string {
    return changes.map((c) => `${sheetChangeLabels[c]?.en ?? c} · ${sheetChangeLabels[c]?.ar ?? ''}`).join('، ');
  }

  protected capital(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
}
