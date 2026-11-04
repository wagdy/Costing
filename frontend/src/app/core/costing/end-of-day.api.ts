import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// The end of the day (تقفيل اليوم), as the API keeps it: a day's invoices handed in with their
// photos, cash and on credit, and its sales report; a draft until it is submitted.
export type EndOfDayStatus = 'Draft' | 'Submitted';
export type EndOfDayInvoiceKind = 'Cash' | 'Credit';

export interface EndOfDayPhoto {
  fileName: string;
  contentType: string;
  bytes: number;
}

export interface EndOfDayInvoice {
  id: string;
  kind: EndOfDayInvoiceKind;
  supplierId: string;
  supplier: string;
  reportedTotal: number;
  note: string | null;
  photo: EndOfDayPhoto;
  addedAtUtc: string;
  // The purchase invoice it was posted as on the daily batch.
  purchaseInvoiceId: string | null;
  postedAtUtc: string | null;
}

export interface EndOfDay {
  id: string;
  date: string;
  status: EndOfDayStatus;
  cashAmount: number | null;
  cardAmount: number | null;
  taxAmount: number | null;
  voidsAmount: number | null;
  notes: string | null;
  salesPhoto: EndOfDayPhoto | null;
  invoices: EndOfDayInvoice[];
  cashInvoices: number;
  cashInvoicesTotal: number;
  creditInvoices: number;
  creditInvoicesTotal: number;
  // Cash and Visa before tax; with the tax; the cash once the cash invoices were paid out of it;
  // and what should reach the safe, everything less the cash invoices.
  netSales: number;
  totalRevenue: number;
  cashAfterInvoices: number;
  expectedIntoSafe: number;
  // How many of its invoices are posted on the daily batch.
  posted: number;
  // The day's takings as entered on Financials, if they are.
  takingsEntered: number | null;
  createdBy: string;
  createdAtUtc: string;
  updatedBy: string;
  updatedAtUtc: string;
  submittedBy: string | null;
  submittedAtUtc: string | null;
  reopenedBy: string | null;
  reopenedAtUtc: string | null;
}

export interface EndOfDaySales {
  cashAmount: number | null;
  cardAmount: number | null;
  taxAmount: number | null;
  voidsAmount: number | null;
  notes: string | null;
}

export interface EndOfDayInvoiceEntry {
  kind: EndOfDayInvoiceKind;
  supplierId: string;
  reportedTotal: number;
  note: string | null;
}

export const invoiceKindLabels: Record<EndOfDayInvoiceKind, { en: string; ar: string }> = {
  Cash: { en: 'Cash', ar: 'نقدي' },
  Credit: { en: 'On credit', ar: 'آجل' },
};

export const endOfDayStatusLabels: Record<EndOfDayStatus, { en: string; ar: string }> = {
  Draft: { en: 'Draft', ar: 'مسودة' },
  Submitted: { en: 'Submitted', ar: 'تم الإرسال' },
};

// What a photo handed in can be, as an invoice's paper is.
export const photoTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const photoMaxBytes = 10 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class EndOfDayApi {
  private readonly http = inject(HttpClient);

  // The day, or null before anything is handed in for it.
  day(date: string): Observable<EndOfDay | null> {
    return this.http.get<EndOfDay | null>(`/api/end-of-day/${date}`);
  }

  days(from: string, to: string): Observable<EndOfDay[]> {
    return this.http.get<EndOfDay[]>('/api/end-of-day', { params: { from, to } });
  }

  saveSales(date: string, sales: EndOfDaySales): Observable<EndOfDay> {
    return this.http.put<EndOfDay>(`/api/end-of-day/${date}/sales`, sales);
  }

  // The id is made here, once per invoice: sent again, it is not added twice.
  addInvoice(date: string, id: string, entry: EndOfDayInvoiceEntry, file: File): Observable<EndOfDay> {
    const form = new FormData();
    form.append('invoiceId', id);
    form.append('kind', entry.kind);
    form.append('supplierId', entry.supplierId);
    form.append('reportedTotal', String(entry.reportedTotal));
    if (entry.note) {
      form.append('note', entry.note);
    }
    form.append('file', file, file.name);
    return this.http.post<EndOfDay>(`/api/end-of-day/${date}/invoices`, form);
  }

  changeInvoice(date: string, id: string, entry: EndOfDayInvoiceEntry): Observable<EndOfDay> {
    return this.http.put<EndOfDay>(`/api/end-of-day/${date}/invoices/${id}`, entry);
  }

  replaceInvoicePhoto(date: string, id: string, file: File): Observable<EndOfDay> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.put<EndOfDay>(`/api/end-of-day/${date}/invoices/${id}/photo`, form);
  }

  removeInvoice(date: string, id: string): Observable<EndOfDay> {
    return this.http.delete<EndOfDay>(`/api/end-of-day/${date}/invoices/${id}`);
  }

  attachSalesPhoto(date: string, file: File): Observable<EndOfDay> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.put<EndOfDay>(`/api/end-of-day/${date}/sales-photo`, form);
  }

  removeSalesPhoto(date: string): Observable<EndOfDay> {
    return this.http.delete<EndOfDay>(`/api/end-of-day/${date}/sales-photo`);
  }

  submit(date: string): Observable<EndOfDay> {
    return this.http.post<EndOfDay>(`/api/end-of-day/${date}/submit`, null);
  }

  reopen(date: string): Observable<EndOfDay> {
    return this.http.post<EndOfDay>(`/api/end-of-day/${date}/reopen`, null);
  }

  // A photo of the day: an invoice's by its id, the sales report's by the day's.
  photo(date: string, photoId: string): Observable<Blob> {
    return this.http.get(`/api/end-of-day/${date}/photos/${photoId}`, { responseType: 'blob' });
  }
}

// A phone's photo made lighter to send: no side over 2,000 pixels, as a JPEG, upright as it was
// taken. A PDF, a small picture, or a browser that cannot draw it, sent as it is.
export async function shrinkPhoto(file: File, maxSide = 2000, quality = 0.85): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 700 * 1024 || typeof createImageBitmap !== 'function') {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) {
      return file;
    }
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

// What stops a file being handed in, or null.
export function photoProblem(file: File): string | null {
  if (!photoTypes.includes(file.type)) {
    return 'Attach a photo (JPEG, PNG or WebP) or a PDF. · أرفق صورة أو ملف PDF.';
  }
  return file.size > photoMaxBytes ? 'The file must be under 10 MB. · الملف أقل من 10 ميجا.' : null;
}
